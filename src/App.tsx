import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Marker } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
    ArrowUpRight,
    BadgeCheck,
    Building2,
    CircleHelp,
    ChevronRight,
    Globe,
    Phone,
    Navigation,
    FileText,
    Info,
    Star,
    ChevronDown,
    LocateFixed,
    MapPin,
    Search,
    ShieldCheck,
    SlidersHorizontal,
    X,
} from 'lucide-react'
import {
    businesses,
    categoryLabels,
    importSummary,
    ownershipLabels,
    type Business,
    type BusinessCategory,
    type OwnershipChainStep,
    type OwnershipClassification,
} from './businesses'
import { distanceMiles, supportedZipCentroids, type SearchCenter, zipCentroidSource } from './location'
import 'maplibre-gl/dist/maplibre-gl.css'

const categories = Object.keys(categoryLabels) as BusinessCategory[]
const ownershipTypes = Object.keys(ownershipLabels) as OwnershipClassification[]
const DEFAULT_SEARCH_CENTER: SearchCenter = { latitude: 36.8508, longitude: -76.2859, label: 'Norfolk, VA' }
const radiusOptions = [5, 10, 15, 25, 50] as const
type SearchRadius = typeof radiusOptions[number] | 'all'
const radiusZoom: Record<Exclude<SearchRadius, 'all'>, number> = {
    5: 11.6,
    10: 11,
    15: 10.5,
    25: 9.8,
    50: 9,
}
const ownershipSortOrder: Record<OwnershipClassification, number> = {
    'pe-backed': 0,
    independent: 1,
    corporate: 2,
    unknown: 3,
}
maplibregl.setWorkerUrl(maplibreWorkerUrl)

function App() {
    const mapContainer = useRef<HTMLDivElement>(null)
    const map = useRef<maplibregl.Map | null>(null)
    const markers = useRef<Marker[]>([])
    const [viewMode, setViewMode] = useState<'directory' | 'map'>('directory')
    const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
    const [verifiedOnly, setVerifiedOnly] = useState(false)
    const [completeOnly, setCompleteOnly] = useState(false)
    const [activeCategory, setActiveCategory] = useState<BusinessCategory>('hvac')
    const [activeOwnership, setActiveOwnership] = useState<OwnershipClassification[]>(ownershipTypes)
    const [sortMode, setSortMode] = useState<'nearest' | 'alphabetical' | 'ownership'>('nearest')
    const [search, setSearch] = useState('')
    const [zipInput, setZipInput] = useState('')
    const [searchCenter, setSearchCenter] = useState<SearchCenter>(DEFAULT_SEARCH_CENTER)
    const [radius, setRadius] = useState<SearchRadius>(15)
    const [locationMessage, setLocationMessage] = useState('')
    const [isLocating, setIsLocating] = useState(false)
    const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
    const [mapUnavailable, setMapUnavailable] = useState<string | null>(null)
    const [mapInitialized, setMapInitialized] = useState(false)

    const visibleRows = useMemo(() => businesses.map((business) => ({
        business,
        distance: distanceMiles(searchCenter, business),
    })).filter(({ business, distance }) => {
        const matchesCategory = business.category === activeCategory
        const matchesOwnership = activeOwnership.includes(business.ownership.classification)
        const searchText = `${business.name} ${business.city} ${business.neighborhood ?? ''}`.toLowerCase()
        const matchesRadius = radius === 'all' || distance <= radius
        return matchesCategory && matchesOwnership && matchesRadius && (!verifiedOnly || business.ownership.status === 'verified') && (!completeOnly || !business.incompleteFields?.length) && searchText.includes(search.trim().toLowerCase())
    }).sort((left, right) => {
        if (sortMode === 'nearest') return left.distance - right.distance || left.business.name.localeCompare(right.business.name)
        if (sortMode === 'ownership') {
            const ownershipDifference = ownershipSortOrder[left.business.ownership.classification] - ownershipSortOrder[right.business.ownership.classification]
            if (ownershipDifference !== 0) return ownershipDifference
        }
        return left.business.name.localeCompare(right.business.name)
    }), [searchCenter, radius, activeCategory, activeOwnership, search, verifiedOnly, completeOnly, sortMode])
    const visibleBusinesses = useMemo(() => visibleRows.map(({ business }) => business), [visibleRows])
    const visibleBusinessKey = visibleBusinesses.map((business) => business.id).join('|')

    const submitZip = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const zip = zipInput.trim()
        const centroid = supportedZipCentroids[zip]
        if (!/^\d{5}$/.test(zip) || !centroid) {
            setLocationMessage('Enter a supported 5-digit Hampton Roads ZIP code.')
            return
        }
        setSearchCenter({ ...centroid, label: `ZIP ${zip} · ${centroid.city}` })
        setLocationMessage('')
        setSelectedBusiness(null)
    }

    const useMyLocation = () => {
        if (!navigator.geolocation) {
            setLocationMessage('Location is not available in this browser.')
            return
        }
        setIsLocating(true)
        setLocationMessage('')
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => {
                setSearchCenter({ latitude: coords.latitude, longitude: coords.longitude, label: 'Your location' })
                setSelectedBusiness(null)
                setIsLocating(false)
            },
            (error) => {
                setLocationMessage(error.code === error.PERMISSION_DENIED
                    ? 'Location permission was denied. Enter a ZIP code instead.'
                    : 'Could not get your location. Enter a ZIP code instead.')
                setIsLocating(false)
            },
            { enableHighAccuracy: false, maximumAge: 300_000, timeout: 10_000 },
        )
    }

    useEffect(() => {
        if (!mapContainer.current) return

        const instance = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://tiles.openfreemap.org/styles/liberty',
            center: [DEFAULT_SEARCH_CENTER.longitude, DEFAULT_SEARCH_CENTER.latitude],
            zoom: radiusZoom[15],
            minZoom: 7.5,
            maxZoom: 16,
            attributionControl: false,
        })

        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
        instance.addControl(new maplibregl.AttributionControl({
            compact: true,
            customAttribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> | © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> | © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        }), 'bottom-left')
        instance.on('load', () => {
            setMapUnavailable(null)
        })
        instance.on('error', (event) => setMapUnavailable(event.error.message))
        map.current = instance
        setMapInitialized(true)

        return () => {
            markers.current.forEach((marker) => marker.remove())
            markers.current = []
            instance.remove()
            map.current = null
        }
    }, [])

    useEffect(() => {
        if (!map.current || !mapInitialized) return

        markers.current.forEach((marker) => marker.remove())
        markers.current = visibleBusinesses.map((business) => {
            const markerElement = document.createElement('button')
            markerElement.type = 'button'
            markerElement.dataset.businessId = business.id
            const verifiedPe = business.dataSource === 'overture' && business.ownership.classification === 'pe-backed'
            markerElement.className = `map-marker map-marker--${business.category}${verifiedPe ? ' map-marker--verified-pe' : ''}`
            markerElement.setAttribute('aria-label', `Open ${business.name}`)
            markerElement.title = business.name
            markerElement.addEventListener('click', () => {
                setSelectedBusiness(business)
            })

            return new maplibregl.Marker({ element: markerElement, anchor: 'center' })
                .setLngLat([business.longitude, business.latitude])
                .addTo(map.current!)
        })
    }, [visibleBusinesses, mapInitialized])

    useEffect(() => {
        markers.current.forEach(marker => {
            const element = marker.getElement()
            element.classList.toggle('is-selected', element.dataset.businessId === selectedBusiness?.id)
        })
    }, [selectedBusiness, visibleBusinesses])

    useEffect(() => {
        if (!map.current || !mapInitialized) return
        if (radius === 'all' && visibleBusinessKey) {
            const bounds = new maplibregl.LngLatBounds()
            const visibleIds = new Set(visibleBusinessKey.split('|'))
            businesses.forEach((business) => {
                if (visibleIds.has(business.id)) bounds.extend([business.longitude, business.latitude])
            })
            map.current.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 650 })
            return
        }
        if (radius !== 'all') {
            map.current.flyTo({
                center: [searchCenter.longitude, searchCenter.latitude],
                zoom: radiusZoom[radius],
                duration: 650,
            })
        }
    }, [searchCenter, radius, mapInitialized, visibleBusinessKey])

    useEffect(() => {
        if (!mapContainer.current || !map.current) return
        const observer = new ResizeObserver(() => map.current?.resize())
        observer.observe(mapContainer.current)
        return () => observer.disconnect()
    }, [mapInitialized])

    const toggleOwnership = (classification: OwnershipClassification) => {
        setActiveOwnership((current) => current.includes(classification)
            ? current.filter((value) => value !== classification)
            : [...current, classification])
        setSelectedBusiness((current) => current?.ownership.classification === classification ? null : current)
    }

    const chooseBusiness = (business: Business) => {
        setSelectedBusiness(business)
    }

    return (
        <div className={`app-shell view-${viewMode}${filtersOpen ? ' filters-open' : ''}`}>
            <header className="command-bar">
                    <a className="brand" href="#home"><span className="brand-mark"><MapPin size={24} /></span><span className="brand-copy"><span className="brand-wordmark">sorta<span className="brand-light">local</span></span><span className="brand-tagline">Good work, close to home.</span></span></a>
                    <label className="search-box">
                        <Search size={16} aria-hidden="true" />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => {
                                setSearch(event.target.value)
                                setSelectedBusiness(null)
                            }}
                            placeholder="Search a business or city"
                            aria-label="Search businesses or cities"
                        />
                        {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
                        <button type="button" className="current-location-action" onClick={useMyLocation} disabled={isLocating} aria-label={isLocating ? 'Finding your current location' : 'Use my current location'} title="Use my current location"><LocateFixed size={17} /><span>{isLocating ? 'Locating…' : 'Near me'}</span></button>
                    </label>

                <details className="location-picker">
                    <summary aria-label={`Search location: ${searchCenter.label}`}><MapPin size={17} /><span>{searchCenter.label}</span><ChevronDown size={15} /></summary>
                    <div className="location-popover"><h2>Search location</h2>
                    <section className="location-controls" aria-label="Search location">
                        <form className="zip-form" onSubmit={submitZip}>
                            <label className="sr-only" htmlFor="zip-search">ZIP code</label>
                            <input
                                id="zip-search"
                                inputMode="numeric"
                                autoComplete="postal-code"
                                maxLength={5}
                                pattern="[0-9]{5}"
                                value={zipInput}
                                onChange={(event) => setZipInput(event.target.value.replace(/\D/g, '').slice(0, 5))}
                                placeholder="ZIP code"
                            />
                            <button type="submit" className="zip-submit">Set</button>
                        </form>
                        <button type="button" className="geolocation-button" onClick={useMyLocation} disabled={isLocating}>
                            <LocateFixed size={15} /> {isLocating ? 'Locating' : 'Use My Location'}
                        </button>
                    </section>

                    <p>Enter a Hampton Roads ZIP code or use your current location.</p></div>
                </details>
                    <div className="view-switch" aria-label="Display mode">
                        <button aria-pressed={viewMode === 'directory'} onClick={() => setViewMode('directory')}>Directory</button>
                        <button aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}>Map</button>
                    </div>
                    <button className="filter-toggle" aria-label="Additional filters" aria-expanded={filtersOpen} aria-controls="extra-filters" onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} /><span className="filter-toggle-label">Filters</span>{(verifiedOnly || completeOnly) && ' •'}</button>
                {locationMessage && <p className="location-message" role="status">{locationMessage}</p>}
            </header>
            <main className="workspace" id="home">
                <aside className="filter-panel" id="extra-filters" aria-label="Additional filters" hidden={!filtersOpen}>
                    <div className="panel-title"><h2>Refine results</h2><button className="clear-all" onClick={() => { setActiveOwnership(ownershipTypes); setActiveCategory('hvac'); setRadius(15); setVerifiedOnly(false); setCompleteOnly(false); setSearch(''); setSelectedBusiness(null) }}>Clear all</button></div>
                    <section className="filter-group distance-group" aria-labelledby="distance-heading">
                        <div className="filter-group-heading"><h3 id="distance-heading"><LocateFixed size={17} /> Distance</h3><strong>{radius === 'all' ? 'All areas' : `${radius} miles`}</strong></div>
                        <input className="distance-slider" type="range" min="0" max={radiusOptions.length} step="1" value={radius === 'all' ? radiusOptions.length : radiusOptions.indexOf(radius)} aria-label="Search radius" aria-valuetext={radius === 'all' ? 'All Hampton Roads' : `${radius} miles`} onChange={event => { const index = Number(event.target.value); setRadius(index === radiusOptions.length ? 'all' : radiusOptions[index]); setSelectedBusiness(null) }} />
                        <div className="distance-ticks" aria-hidden="true">{[...radiusOptions.map(value => `${value}`), 'All'].map(label => <span key={label}>{label}</span>)}</div>
                    </section>
                    <details className="filter-group" open>
                        <summary><ShieldCheck size={17} /> Ownership <ChevronDown size={15} /></summary>
                        <div className="ownership-filters">
                            {ownershipTypes.map(classification => <label className="ownership-option" key={classification}>
                                <input type="checkbox" checked={activeOwnership.includes(classification)} onChange={() => toggleOwnership(classification)} />
                                <span className={`ownership-dot ownership-dot--${classification}`} />
                                <span>{ownershipLabels[classification]}</span>
                                <span className="ownership-count">{businesses.filter(business => business.category === activeCategory && business.ownership.classification === classification).length}</span>
                            </label>)}
                        </div>
                        <p className="filter-count-note">Totals for {categoryLabels[activeCategory]} across all areas.</p>
                    </details>
                    <details className="filter-group" open>
                        <summary><Building2 size={17} /> Industry <ChevronDown size={15} /></summary>
                        <div className="industry-options">
                            {categories.map(category => <label key={category} className={`industry-option${activeCategory === category ? ' is-active' : ''}`}>
                                <input type="radio" name="industry" checked={activeCategory === category} onChange={() => { setActiveCategory(category); setSelectedBusiness(null) }} />
                                <span>{categoryLabels[category]}</span><span className="ownership-count">{businesses.filter(business => business.category === category).length}</span>
                            </label>)}
                        </div>
                    </details>
                    <details className="filter-group additional-options">
                        <summary><SlidersHorizontal size={17} /> More filters <ChevronDown size={15} /></summary>
                        <label className="refine-option"><input type="checkbox" checked={verifiedOnly} onChange={event => setVerifiedOnly(event.target.checked)} /> Verified ownership records only</label>
                        <label className="refine-option"><input type="checkbox" checked={completeOnly} onChange={event => setCompleteOnly(event.target.checked)} /> Hide incomplete listings</label>
                        <p className="filter-note">Verified records in demo industries are fictional. Unknown ownership is never treated as verified.</p>
                    </details>
                    <details className="data-note"><summary>About this data</summary><p>HVAC listings come from Overture Maps. Dental, veterinary, and auto businesses are fictional demos.</p><p>Ownership is shown only as supported by the record’s evidence.</p>
                    <p>ZIP centroids: <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noreferrer">{zipCentroidSource}</a></p>
                    {activeCategory === 'hvac' && <p>{importSummary.importedRecords} imported HVAC records; {importSummary.incompleteRecords} incomplete.</p>}</details>
                </aside>
                <section className="map-stage" aria-label="Hampton Roads business map">
                    <div className="map-canvas" ref={mapContainer} />
                    <div className="map-heading" aria-live="polite">
                        <strong className="map-result-total">{visibleBusinesses.length} businesses</strong>
                        {ownershipTypes.map(classification => {
                            const count = visibleBusinesses.filter(business => business.ownership.classification === classification).length
                            return count > 0 ? <span className="map-summary-row" key={classification}><span className={`ownership-dot ownership-dot--${classification}`} />{count} {ownershipLabels[classification]}</span> : null
                        })}
                    </div>
                    <button
                        type="button"
                        className="locate-button"
                        aria-label="Center map on the active search location"
                        title="Center map on search location"
                        onClick={() => map.current?.flyTo({ center: [searchCenter.longitude, searchCenter.latitude], zoom: 10.1, duration: 650 })}
                    >
                        <LocateFixed size={17} />
                    </button>
                    {mapUnavailable && <div className="map-message">The interactive map is unavailable: {mapUnavailable}</div>}
                    <div className="map-demo-stamp">OVERTURE + DEMO DATA</div>
                </section>
                <aside className="directory-panel" aria-label="Business directory">
                    <section className="results-section" aria-labelledby="results-heading">
                        <div className="results-heading">
                            <h2 id="results-heading">Businesses <span>{visibleBusinesses.length}</span></h2>
                            <label className="sort-control">
                                <span>Sort</span>
                                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)} aria-label="Sort businesses">
                                    <option value="nearest">Nearest</option>
                                    <option value="alphabetical">A-Z</option>
                                    <option value="ownership">Ownership</option>
                                </select>
                            </label>
                        </div>
                        <div className="business-list">
                            {visibleRows.map(({ business, distance }) => (
                                <BusinessRow
                                    business={business}
                                    key={business.id}
                                    selected={selectedBusiness?.id === business.id}
                                    onSelect={() => chooseBusiness(business)}
                                    distance={distance}
                                />
                            ))}
                            {visibleBusinesses.length === 0 && <p className="empty-results">No matches. Try widening your filters.</p>}
                        </div>
                    </section>

                </aside>
            </main>
            {selectedBusiness && <BusinessDetail business={selectedBusiness} onClose={() => setSelectedBusiness(null)} />}
        </div>
    )
}

function BusinessRow({ business, selected, onSelect, distance }: { business: Business; selected: boolean; onSelect: () => void; distance: number }) {
    const isOverture = business.dataSource === 'overture'

    return (
        <button type="button" className={`business-row${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
            <span className={`business-symbol business-symbol--${business.category}`} aria-hidden="true">{business.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()}</span>
            <span className="business-row-copy">
                <span className="business-row-name">{business.name}</span>
                <span className="business-row-meta">
                    {business.city}, VA <span className="distance-separator">·</span> {distance.toFixed(1)} mi <span className="distance-separator">·</span> {categoryLabels[business.category]}
                    {!isOverture && <span className="record-source record-source--demo">DEMO</span>}
                    {isOverture && business.incompleteFields && business.incompleteFields.length > 0 && (
                        <span className="incomplete-flag" title={`Missing ${business.incompleteFields.join(', ')}`}>INCOMPLETE</span>
                    )}
                </span>
                <OwnershipBadge business={business} compact />
            </span>
            <ChevronRight className="business-row-arrow" size={17} aria-hidden="true" />
        </button>
    )
}

function BusinessDetail({ business, onClose }: { business: Business; onClose: () => void }) {
    const ownership = business.ownership
    const isVerified = ownership.status === 'verified'
    const isOverture = business.dataSource === 'overture'
    const events = [...(ownership.status === 'verified' ? ownership.ownershipChain ?? [] : [])]
        .filter(step => step.relationship !== 'portfolio_company_of')
        .sort((a, b) => ownershipEventDate(a).localeCompare(ownershipEventDate(b)))
    const evidenceCount = isVerified ? new Set([
        ...(ownership.ownershipChain ?? []).flatMap(step => step.evidence.map(evidence => evidence.url)),
        ...ownership.evidence.map(evidence => evidence.url ?? evidence.reference),
    ]).size : 0
    const dialog = useRef<HTMLDialogElement>(null)
    const returnFocus = useRef<HTMLElement | null>(null)

    useEffect(() => {
        returnFocus.current ??= document.activeElement as HTMLElement | null
        dialog.current?.showModal()
        return () => { returnFocus.current?.focus({ preventScroll: true }) }
    }, [])

    return (
        <dialog ref={dialog} className="detail-dialog" aria-labelledby="detail-title"
            onCancel={event => { event.preventDefault(); onClose() }}
            onClick={event => { if (event.target === event.currentTarget) onClose() }}>
            <article className={`detail-panel ${isVerified ? 'profile-verified' : 'profile-unverified'}`}>
                <button type="button" className="icon-button close-detail" onClick={onClose} aria-label="Close business details"><X size={20} /></button>
                <header className="profile-header">
                    <p className="detail-category">{categoryLabels[business.category]} · {business.city}, VA{!isOverture && <span className="profile-demo-label">Fictional demo</span>}</p>
                    <h2 id="detail-title">{business.name}</h2>
                    <OwnershipBadge business={business} />
                    {business.description && <p className="detail-description">{business.description}</p>}
                    <div className="profile-address"><MapPin size={16} /><span>{business.address ? `${business.address}, ${business.city}, VA` : `Street address unavailable · ${business.city}, VA`}</span></div>
                    <ContactActions business={business} />
                </header>
                <div className="profile-body" tabIndex={0} aria-label="Business profile information">
                    {isVerified ? <>
                        <section className="ownership-card" aria-labelledby="chain-heading">
                            <h3 id="chain-heading"><Building2 size={20} /> {ownership.ownershipChain?.length ? 'Ownership chain' : 'Ownership record'}</h3>
                            <OwnershipChain business={business} />
                        </section>
                        {events.length > 0 && <section className="acquisition-summary" aria-labelledby="acquisition-heading">
                            <h3 id="acquisition-heading"><FileText size={18} /> Acquisition timeline</h3>
                            <ol className="acquisition-timeline">
                                {events.map((step, index) => <li key={`${step.fromEntity}-${step.relationship}-${index}`}>
                                    <span className="event-date">{ownershipRelationshipDate(step)}</span>
                                    <div>
                                        <span className="relationship-label">{ownershipRelationshipLabel(step.relationship)}</span>
                                        <strong className="event-title"><span className="event-role">{step.relationship === 'majority_investment_by' ? 'Investor' : step.relationship === 'acquired_by' ? 'Buyer' : 'Related entity'}: </span>{step.toEntity}</strong>
                                        <span className="event-company">Company: {step.fromEntity}</span>
                                    </div>
                                </li>)}
                            </ol>
                        </section>}
                        {(ownership.evidence.length > 0 || ownership.ownershipChain?.length) ? <section className="profile-sources" aria-labelledby="sources-heading">
                            <h3 id="sources-heading"><FileText size={18} /> Sources{evidenceCount > 0 && <span className="profile-section-meta">{evidenceCount} {evidenceCount === 1 ? 'source' : 'sources'}</span>}</h3>
                            {events.length > 0 && <p className="ownership-caveat">Timeline runs earliest to latest by recorded completion date, announcement date, or reported year. An announcement does not confirm a closing date.</p>}
                            {ownership.ownershipChain?.map((step, index) => <div className="relationship" key={`${step.fromEntity}-${step.relationship}-${index}`}>
                                <strong>{step.fromEntity} → {step.toEntity}</strong>
                                <span className="relationship-label">{ownershipRelationshipLabel(step.relationship)} · {step.relationship === 'portfolio_company_of' ? `verified ${formatDate(step.verifiedAt)}` : ownershipRelationshipDate(step)}</span>
                                {step.evidence.map(evidence => <a className="ownership-source-link" href={evidence.url} target="_blank" rel="noreferrer" key={evidence.url}>{evidence.description}<ArrowUpRight size={13} /></a>)}
                            </div>)}
                            {ownership.evidence.map(evidence => <div className="evidence-row" key={evidence.reference}>{evidence.url ? <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.description ?? evidence.source}</a> : <><span>{evidence.source}</span><span>{evidence.reference}</span></>}</div>)}
                        </section> : null}
                        <ProfileSection title="Verification details" icon={<ShieldCheck size={17} />}>
                            <p>{isOverture ? 'Ownership verified' : 'Fictional demo verification'} {formatDate(ownership.verifiedAt)}</p>
                            {isOverture && ownership.approvalStatus === 'approved' && <div className="match-confidence">
                                <strong>Business identity match: {Math.round((ownership.matchConfidence ?? 0) * 100)}%</strong>
                                <p>Based on listing name, domain, and location. Identity matching is separate from ownership verification, which relies on the linked evidence.</p>
                                {ownership.matchReasons?.length ? <ul>{ownership.matchReasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
                            </div>}
                            {isOverture && <p>Current investor relationships were checked on the verification date. Transaction dates follow the original source statements.</p>}
                        </ProfileSection>
                    </> : <section className="unknown-explanation"><Info size={19} /><div><h3>Ownership information</h3><p>We haven’t confirmed this business’s ownership from reviewed sources. This does not establish whether it is independent, corporate-owned, or PE-backed.</p></div></section>}
                    <ProfileSection title="About this data" icon={<Info size={17} />}>
                        {isOverture ? <div className="source-record">
                            <a href="https://overturemaps.org/" target="_blank" rel="noreferrer">Listing from Overture Maps <ArrowUpRight size={12} /></a>
                            <span>Place ID: {business.sourceId}</span>
                            {business.sourceDataset && <span>Provider dataset: {business.sourceDataset}{business.sourceRecordId ? ` / ${business.sourceRecordId}` : ''}</span>}
                            <span>Release {business.sourceRelease}</span>
                            {business.incompleteFields?.length ? <span>Incomplete listing: missing {business.incompleteFields.join(', ')}</span> : null}
                            <p>Listing information and ownership evidence are separate. Ownership is shown only when supported by reviewed sources.</p>
                        </div> : <p>Fictional demonstration record. Not a real business or ownership claim.</p>}
                    </ProfileSection>
                    <div className="reviews-placeholder"><Star size={17} /><strong>Customer reviews</strong><span>Coming soon · No ratings or reviews available.</span></div>

                </div>
            </article>
        </dialog>
    )
}

function ContactActions({ business }: { business: Business }) {
    return <div className="contact-actions" aria-label="Contact and directions">
        {business.website ? <a className="profile-website" href={business.website} target="_blank" rel="noreferrer"><Globe size={16} /> Visit website <ArrowUpRight size={13} /></a> : <span>Website unavailable</span>}
        {business.phone ? <a href={`tel:${business.phone.replace(/[^+\d]/g, '')}`} aria-label={`Call ${business.phone}`}><Phone size={16} />{business.phone}</a> : <span>Phone unavailable</span>}
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${business.latitude},${business.longitude}`)}`} target="_blank" rel="noreferrer"><Navigation size={16} /> Directions <ArrowUpRight size={13} /></a>
    </div>
}

function ProfileSection({ title, icon, meta, children }: { title: string; icon: ReactNode; meta?: string; children: ReactNode }) {
    return <details className="profile-section">
        <summary><span className="profile-section-icon">{icon}</span><span className="profile-section-title">{title}</span>{meta && <span className="profile-section-meta">{meta}</span>}<ChevronDown size={15} className="profile-section-chevron" aria-hidden="true" /></summary>
        <div className="profile-section-content">{children}</div>
    </details>
}

// Follow only recorded links. Merge duplicate graph edges for the visual chain;
// keep every relationship and its original evidence in the sources section.
function ownershipPaths(steps: OwnershipChainStep[]): OwnershipChainStep[][] {
    const unique = steps.filter((step, index) => steps.findIndex(other => other.fromEntity === step.fromEntity && other.toEntity === step.toEntity) === index)
    const roots = unique.filter(step => !unique.some(other => other.toEntity === step.fromEntity))
    const paths: OwnershipChainStep[][] = []
    const walk = (path: OwnershipChainStep[]) => {
        const last = path[path.length - 1]
        const next = unique.filter(step => step.fromEntity === last.toEntity && !path.some(previous => previous.fromEntity === step.toEntity))
        if (next.length) next.forEach(step => walk([...path, step]))
        else paths.push(path)
    }
    ;(roots.length ? roots : unique).forEach(step => walk([step]))
    return paths
}

function OwnershipChain({ business }: { business: Business }) {
    const ownership = business.ownership
    if (ownership.status !== 'verified') return null
    if (ownership.ownershipChain?.length) return <div className="chain-diagram">
        {ownershipPaths(ownership.ownershipChain).map((path, index) => <ol className="chain-path" key={index} aria-label="Recorded ownership relationships">
            <li className="chain-node"><Building2 size={19} /><strong>{path[0].fromEntity}</strong></li>
            {path.map((step, stepIndex) => <li className="chain-step" key={`${step.toEntity}-${stepIndex}`}>
                <span className="chain-arrow"><small>{step.relationship === 'acquired_by' ? 'Acquired by' : ownershipRelationshipLabel(step.relationship)}</small><span aria-hidden="true">→</span></span>
                <span className="chain-node"><Building2 size={19} /><strong>{step.toEntity}</strong></span>
            </li>)}
        </ol>)}
    </div>
    return <div className="ownership-record">
        {ownership.relationships.map(relationship => <div className="relationship" key={`${relationship.entity}-${relationship.relationship}`}>
            <span className="relationship-label">{relationship.relationship}{business.dataSource !== 'overture' ? ' · fictional demo' : ''}</span><strong>{relationship.entity}</strong>
        </div>)}
        {!ownership.relationships.length && <p>{ownershipLabels[ownership.classification]} · verified {formatDate(ownership.verifiedAt)}</p>}
    </div>
}

function OwnershipBadge({ business, compact = false }: { business: Business; compact?: boolean }) {
    const verified = business.ownership.status === 'verified'
    const demo = business.dataSource !== 'overture'
    return <span className={`ownership-badge ownership-badge--${business.ownership.classification}${compact ? ' ownership-badge--compact' : ''}`}>
        {verified ? <BadgeCheck size={compact ? 14 : 18} /> : <CircleHelp size={compact ? 14 : 18} />}
        <span>{!verified && !compact ? 'Ownership unverified' : ownershipLabels[business.ownership.classification]}</span>
        {!compact && verified && <small>{demo ? 'FICTIONAL DEMO' : 'APPROVED'}</small>}
    </span>
}

function ownershipEventDate(step: { announcedAt: string | null; effectiveAt: string | null; effectiveYear?: number }) {
    return step.effectiveAt ?? step.announcedAt ?? (step.effectiveYear ? `${step.effectiveYear}-01-01` : '9999-12-31')
}

function formatDate(date: string | null) {
    if (!date) return 'Not verified'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

function ownershipRelationshipLabel(relationship: string) {
    if (relationship === 'acquired_by') return 'Acquisition'
    if (relationship === 'majority_investment_by') return 'Majority investment'
    if (relationship === 'portfolio_company_of') return 'Portfolio relationship'
    return relationship.replaceAll('_', ' ')
}

function ownershipRelationshipDate(step: { announcedAt: string | null; effectiveAt: string | null; effectiveYear?: number }) {
    if (step.effectiveAt) return `Completed ${formatDate(step.effectiveAt)}${step.announcedAt ? ` · announced ${formatDate(step.announcedAt)}` : ''}`
    if (step.announcedAt) return `Announced ${formatDate(step.announcedAt)} · close date not disclosed`
    if (step.effectiveYear) return `Reported in ${step.effectiveYear} · exact date not disclosed`
    return 'Effective date not disclosed'
}

export default App
