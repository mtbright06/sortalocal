// Render the real UI and approved records without requiring a browser or network.
// Run with: node tests/consumer_ui_checks.mjs
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const previousWindow = globalThis.window
let viewportWidth = 1280
globalThis.window = { matchMedia: () => ({ matches: viewportWidth >= 1024 }) }
const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    plugins: [{
        name: 'expose-profile-for-render-checks',
        enforce: 'pre',
        transform(code, id) {
            if (id.split('?')[0].endsWith('/src/App.tsx')) {
                const renderCode = id.includes('industry-open-test') ? code.replace('const [isOpen, setIsOpen] = useState(false)', 'const [isOpen, setIsOpen] = useState(true)') : code
                return `${renderCode}\nexport { BusinessDetail, ownershipPaths, ownershipEventDate, IndustrySelector };`
            }
        },
    }],
})
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
try {
    const { default: App, BusinessDetail, ownershipPaths, ownershipEventDate, IndustrySelector } = await server.ssrLoadModule('/src/App.tsx')
    const { businesses } = await server.ssrLoadModule('/src/businesses.ts')
    assert.equal(businesses.filter(business => business.dataSource === 'overture').length, 293)
    for (viewportWidth of [1280, 1440, 1920, 390]) {
        const html = renderToStaticMarkup(createElement(App))
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
        assert(!header.includes('Search radius'), 'Radius stays out of the top bar')
        assert(header.includes('aria-label="Use my current location"'), 'Current location is directly accessible from the header')
        assert(html.includes('Search radius'), 'Distance filtering remains accessible')
        assert(html.includes('Sort businesses'))
        assert(html.includes('Business directory'))
        assert.equal((html.match(/Good work, close to home\./g) ?? []).length, 1)
        assert.equal(html.includes('aria-expanded="true"'), viewportWidth >= 1024)
        assert(html.includes('distance-slider'))
        assert(html.includes('aria-haspopup="listbox"'))
        assert(!html.includes('name="industry"'), 'Industry radios have been replaced')
        assert.equal((html.match(/aria-haspopup="listbox"/g) ?? []).length, 1, 'Only one industry selector')
        assert(html.indexOf('distance-group') < html.indexOf('industry-picker'))
        assert(html.indexOf('industry-picker') < html.indexOf('ownership-filters'))
        assert(html.indexOf('ownership-filters') < html.indexOf('additional-options'))
        assert(html.includes('Totals for HVAC across all areas.'))
        assert(html.includes('map-summary-row'))
    }
    // Render both states for every real category. Interaction/viewport checks
    // still require a connected browser; these are markup and data checks only.
    const { IndustrySelector: OpenIndustrySelector } = await server.ssrLoadModule('/src/App.tsx?industry-open-test')
    const { categoryLabels } = await server.ssrLoadModule('/src/businesses.ts')
    for (const [category, label] of Object.entries(categoryLabels)) {
        const closed = renderToStaticMarkup(createElement(IndustrySelector, { value: category, onChange() {} }))
        assert(closed.includes(escape(label)))
        assert(closed.includes('aria-expanded="false"'))
        assert(!closed.includes('role="listbox"'))
        assert(!closed.includes('<select'))
        const opened = renderToStaticMarkup(createElement(OpenIndustrySelector, { value: category, onChange() {} }))
        assert(opened.includes('role="listbox"'))
        assert.equal((opened.match(/role="option"/g) ?? []).length, Object.keys(categoryLabels).length)
        assert.equal((opened.match(/aria-selected="true"/g) ?? []).length, 1)
        const selected = opened.match(/<button[^>]*role="option"[^>]*aria-selected="true"[^>]*>([\s\S]*?)<\/button>/)?.[1]
        assert(selected?.includes(escape(label)))
        assert(selected?.includes('lucide-check'), 'Selected industry has a checkmark')
        for (const optionLabel of Object.values(categoryLabels)) assert(opened.includes(escape(optionLabel)))
    }
    console.log('Passed industry selector checks: sidebar order, single custom control, icons, and selected menu option for every category.')
    for (const business of businesses) {
        const html = renderToStaticMarkup(createElement(BusinessDetail, { business, onClose() {} }))
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
        assert(header.includes(escape(business.name)), 'Business name stays in the header')
        assert(header.includes('Directions'))
        if (business.website) assert(header.includes(escape(business.website)), 'Website is immediately accessible')
        if (business.phone) assert(header.includes('tel:'), 'Phone is immediately accessible')
        assert(!html.includes('Good work, close to home.'))
        assert(html.includes('Close business details'))
        assert(!/<details\b[^>]*\bopen(?:[=\s>])/.test(html), 'Technical sections start collapsed')
        if (business.ownership.status === 'unknown') {
            assert(html.includes('profile-unverified'))
            assert(html.includes('Ownership unverified'))
            assert(!html.includes('Ownership chain'))
            assert(!html.includes('Acquisition history'))
            assert(!html.includes('Verification details'))
            continue
        }
        assert(html.includes('profile-verified'))
        const steps = business.ownership.ownershipChain ?? []
        const paths = ownershipPaths(steps)
        const visibleChain = html.slice(html.indexOf('id="chain-heading"'), html.indexOf('<details'))
        for (const path of paths) {
            path.forEach((step, index) => {
                if (index) assert.equal(path[index - 1].toEntity, step.fromEntity, 'No inferred chain links')
                assert(visibleChain.includes(escape(step.fromEntity)))
                assert(visibleChain.includes(escape(step.toEntity)))
            })
        }
        for (const step of steps) {
            for (const evidence of step.evidence) assert(html.includes(escape(evidence.url)), 'All original evidence links remain available')
        }
        const events = steps.filter(step => !['portfolio_company_of', 'formed_through_partnership'].includes(step.relationship)).sort((a, b) => ownershipEventDate(a).localeCompare(ownershipEventDate(b)))
        let previousPosition = -1
        const timeline = html.match(/<ol class="acquisition-timeline">([\s\S]*?)<\/ol>/)?.[1] ?? ''
        for (const event of events) {
            const position = timeline.indexOf(`Company: ${escape(event.fromEntity)}`, previousPosition + 1)
            assert(position > previousPosition, 'Acquisition events render chronologically')
            assert(timeline.includes(escape(event.toEntity)), 'Timeline includes the buyer or investor')
            previousPosition = position
        }
    }
    // Acceptance: Guy Smith's chain and both dated events precede any details.
    const guySmith = businesses.find(business => business.name === 'Guy Smith Heating & Air Conditioning')
    assert(guySmith, 'Guy Smith listing exists')
    const guyHtml = renderToStaticMarkup(createElement(BusinessDetail, { business: guySmith, onClose() {} }))
    const initiallyVisible = guyHtml.slice(0, guyHtml.indexOf('<details'))
    assert(initiallyVisible.includes('Guy Smith Home Services'))
    assert(initiallyVisible.includes('Sila Services, LLC'))
    assert(initiallyVisible.includes('Goldman Sachs Alternatives'))
    assert(initiallyVisible.includes('Acquisition timeline'))
    assert.equal((initiallyVisible.match(/class="event-date"/g) ?? []).length, 2)
    assert(initiallyVisible.includes('Nov 12, 2024'))
    assert(initiallyVisible.includes('Apr 3, 2025'))
    assert(initiallyVisible.includes('Majority investment'))
    assert(initiallyVisible.includes('Acquisition'))
    assert(initiallyVisible.includes('id="sources-heading"'), 'Sources render outside all expandable sections')
    assert(initiallyVisible.includes('ownership-source-link'), 'Evidence links are immediately available')
    assert(!guyHtml.includes('View sources'))
    for (const step of guySmith.ownership.ownershipChain) {
        for (const evidence of step.evidence) assert(initiallyVisible.includes(escape(evidence.url)), 'Every Guy Smith evidence link is outside expandable sections')
    }
    assert(guyHtml.includes('Verification details'))
    console.log('Passed Guy Smith acceptance check: chain and both dated events render outside all expandable sections.')

    const smithKeene = businesses.find(business => business.id === 'overture-9e594c69-5dcc-46e7-bea7-e5c656d7198e')
    assert(smithKeene?.ownership.status === 'verified')
    assert.equal(smithKeene.ownership.classification, 'pe-backed')
    const smithHtml = renderToStaticMarkup(createElement(BusinessDetail, { business: smithKeene, onClose() {} }))
    const smithChain = smithHtml.slice(smithHtml.indexOf('id="chain-heading"'), smithHtml.indexOf('<details'))
    for (const name of ['Smith & Keene Home Services LLC', 'Cascade Services', 'Trive Capital', 'LP First Capital', 'Cascade Services management team']) {
        assert(smithChain.includes(escape(name)), `Approved Smith & Keene partnership chain includes ${name}`)
    }
    assert(smithHtml.includes('Announced Sep 5, 2024'))
    assert(smithHtml.includes('residential carve-out'))
    assert(smithHtml.includes('seller&#x27;s new-construction business remained and operated as S &amp; K Electric.'))
    assert(smithHtml.includes('An announcement does not confirm a closing date.'))
    console.log('Passed Smith & Keene approval check: scoped carve-out, announcement date, and Cascade partner branches render.')
    // Exercise absent fields and lengthy content using copies of real records.
    // These fixtures are never added to the business dataset.
    const verified = businesses.find(business => business.dataSource === 'overture' && business.ownership.status === 'verified' && business.ownership.ownershipChain?.length)
    const unknown = businesses.find(business => business.dataSource === 'overture' && business.ownership.status === 'unknown')
    assert(verified && unknown)
    const limitedContact = { ...unknown, address: null, phone: null, website: null, description: undefined }
    const limitedHtml = renderToStaticMarkup(createElement(BusinessDetail, { business: limitedContact, onClose() {} }))
    assert(limitedHtml.includes('Street address unavailable'))
    assert(limitedHtml.includes('Website unavailable'))
    assert(limitedHtml.includes('Phone unavailable'))
    assert(!limitedHtml.includes('tel:'))
    assert(!limitedHtml.includes('profile-website'))
    assert(!limitedHtml.includes('Acquisition history'))
    assert(!limitedHtml.includes('Business identity match'))

    const extensiveSteps = Array.from({ length: 20 }, () => verified.ownership.ownershipChain).flat()
    const extensive = { ...verified, name: Array(4).fill(verified.name).join(' / '), ownership: { ...verified.ownership, ownershipChain: extensiveSteps } }
    const extensiveHtml = renderToStaticMarkup(createElement(BusinessDetail, { business: extensive, onClose() {} }))
    assert(extensiveHtml.includes(escape(extensive.name)))
    const originalPaths = ownershipPaths(verified.ownership.ownershipChain)
    assert.deepEqual(ownershipPaths(extensiveSteps), originalPaths, 'Repeated evidence must not duplicate chain entities')
    const expectedEvents = extensiveSteps.filter(step => !['portfolio_company_of', 'formed_through_partnership'].includes(step.relationship)).length
    assert.equal((extensiveHtml.match(/class="event-date"/g) ?? []).length, expectedEvents, 'Extensive acquisition history is fully retained')
    const visibleHeader = extensiveHtml.slice(extensiveHtml.indexOf('<header'), extensiveHtml.indexOf('</header>'))
    assert(!visibleHeader.includes('Business identity match'), 'Identity confidence stays secondary')
    assert(!extensiveHtml.includes('<img'), 'No invented business photographs')
    console.log('Passed limited-contact, long-name, extensive-history, and duplicate-chain stress checks.')
    console.log(`Passed rendered-content checks for ${businesses.length} profiles, 293 HVAC records, chain continuity, evidence links, chronological events, contact actions, branding, and responsive filter defaults.`)
    console.log('These checks do not simulate browser layout, scrolling, clicks, or Escape.')
} finally {
    await server.close()
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
}
