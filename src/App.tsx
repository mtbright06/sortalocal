import { useEffect, useRef, useState, type FormEvent } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Marker } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import {
    ArrowUpRight,
    BadgeCheck,
    Building2,
    CircleHelp,
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
    const businessRows = useRef(new Map<string, HTMLButtonElement>())
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

    const visibleRows = businesses.map((business) => ({
        business,
        distance: distanceMiles(searchCenter, business),
    })).filter(({ business, distance }) => {
        const matchesCategory = business.category === activeCategory
        const matchesOwnership = activeOwnership.includes(business.ownership.classification)
        const searchText = `${business.name} ${business.city} ${business.neighborhood ?? ''}`.toLowerCase()
        const matchesRadius = radius === 'all' || distance <= radius
        return matchesCategory && matchesOwnership && matchesRadius && searchText.includes(search.trim().toLowerCase())
    }).sort((left, right) => {
        if (sortMode === 'nearest') return left.distance - right.distance || left.business.name.localeCompare(right.business.name)
        if (sortMode === 'ownership') {
            const ownershipDifference = ownershipSortOrder[left.business.ownership.classification] - ownershipSortOrder[right.business.ownership.classification]
            if (ownershipDifference !== 0) return ownershipDifference
        }
        return left.business.name.localeCompare(right.business.name)
    })
    const visibleBusinesses = visibleRows.map(({ business }) => business)
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
            markerElement.className = `map-marker map-marker--${business.category}${selectedBusiness?.id === business.id ? ' is-selected' : ''}`
            markerElement.setAttribute('aria-label', `Open ${business.name}`)
            markerElement.title = business.name
            markerElement.addEventListener('click', () => {
                setSelectedBusiness(business)
                map.current?.flyTo({ center: [business.longitude, business.latitude], zoom: 11.5, duration: 650 })
            })

            return new maplibregl.Marker({ element: markerElement, anchor: 'center' })
                .setLngLat([business.longitude, business.latitude])
                .addTo(map.current!)
        })
    }, [visibleBusinesses, selectedBusiness, mapInitialized])

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
        if (selectedBusiness) {
            businessRows.current.get(selectedBusiness.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        }
    }, [selectedBusiness])

    const toggleOwnership = (classification: OwnershipClassification) => {
        setActiveOwnership((current) => current.includes(classification)
            ? current.filter((value) => value !== classification)
            : [...current, classification])
        setSelectedBusiness((current) => current?.ownership.classification === classification ? null : current)
    }

    const chooseBusiness = (business: Business) => {
        setSelectedBusiness(business)
        map.current?.flyTo({ center: [business.longitude, business.latitude], zoom: 11.5, duration: 650 })
    }

    return (
        <div className="app-shell">
            <header className="topbar">
                <a className="brand" href="#home" aria-label="Sorta Local home">
                    <span className="brand-mark"><MapPin size={19} strokeWidth={2.2} /></span>
                    <span>sorta<span className="brand-light">local</span></span>
                </a>
                <div className="topbar-place"><span className="place-dot" /> HAMPTON ROADS, VA</div>
                <div className="demo-label"><span /> OVERTURE + DEMO DATA</div>
            </header>

            <main className="workspace" id="home">
                <aside className="explorer" aria-label="Business directory filters">
                    <div className="explorer-heading">
                        <p className="eyebrow">A local-first guide</p>
                        <h1>Good work,<br /><em>close to home.</em></h1>
                        <p className="intro-copy">Find the people who keep Hampton Roads running.</p>
                    </div>

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
                    </label>

                    <section className="location-controls" aria-label="Location and search radius">
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
                        <label className="radius-control">
                            <span>Within</span>
                            <select
                                value={radius}
                                aria-label="Search radius"
                                onChange={(event) => {
                                    const nextRadius = event.target.value === 'all' ? 'all' : Number(event.target.value) as SearchRadius
                                    setRadius(nextRadius)
                                    setSelectedBusiness(null)
                                }}
                            >
                                {radiusOptions.map((option) => <option value={option} key={option}>{option} miles</option>)}
                                <option value="all">All Hampton Roads</option>
                            </select>
                        </label>
                        <button type="button" className="geolocation-button" onClick={useMyLocation} disabled={isLocating}>
                            <LocateFixed size={15} /> {isLocating ? 'Locating' : 'Use My Location'}
                        </button>
                    </section>
                    <div className="location-status" aria-live="polite">
                        <span>{searchCenter.label}</span>
                        <span>{radius === 'all' ? 'All Hampton Roads' : `${radius} mi`}</span>
                        <strong>{visibleBusinesses.length} matches</strong>
                    </div>
                    <div className="location-attribution">ZIP centroids: <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noreferrer">{zipCentroidSource}</a></div>
                    {locationMessage && <p className="location-message" role="status">{locationMessage}</p>}

                    <section className="filter-section" aria-labelledby="category-heading">
                        <div className="section-label"><SlidersHorizontal size={14} /><h2 id="category-heading">What do you need?</h2></div>
                        <div className="category-filters" role="radiogroup" aria-labelledby="category-heading">
                            {categories.map((category) => (
                                <button
                                    type="button"
                                    role="radio"
                                    key={category}
                                    className={`category-filter${activeCategory === category ? ' is-active' : ''}`}
                                    aria-checked={activeCategory === category}
                                    tabIndex={activeCategory === category ? 0 : -1}
                                    onClick={() => {
                                        setActiveCategory(category)
                                        setSelectedBusiness(null)
                                    }}
                                >
                                    {categoryLabels[category]}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="filter-section ownership-section" aria-labelledby="ownership-heading">
                        <div className="section-label"><ShieldCheck size={14} /><h2 id="ownership-heading">Ownership</h2></div>
                        <div className="ownership-filters">
                            {ownershipTypes.map((classification) => (
                                <label className="ownership-option" key={classification}>
                                    <input
                                        type="checkbox"
                                        checked={activeOwnership.includes(classification)}
                                        onChange={() => toggleOwnership(classification)}
                                    />
                                    <span className={`ownership-dot ownership-dot--${classification}`} />
                                    <span>{ownershipLabels[classification]}</span>
                                    <span className="ownership-count">{businesses.filter((business) => business.ownership.classification === classification).length}</span>
                                </label>
                            ))}
                        </div>
                    </section>

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
                                    rowRef={(element) => {
                                        if (element) businessRows.current.set(business.id, element)
                                        else businessRows.current.delete(business.id)
                                    }}
                                />
                            ))}
                            {visibleBusinesses.length === 0 && <p className="empty-results">No matches. Try widening your filters.</p>}
                        </div>
                    </section>
                    {activeCategory === 'hvac' && (
                        <div className="import-summary" aria-label="Overture import summary">
                            <span><strong>{importSummary.importedRecords}</strong> imported</span>
                            <span><strong>{importSummary.excludedOutsideTargetCities}</strong> outside cities</span>
                            <span><strong>{importSummary.excludedKnownFalsePositives.length}</strong> excluded</span>
                            <span><strong>{importSummary.incompleteRecords}</strong> incomplete</span>
                            <details className="exclusion-notes">
                                <summary>Exclusion notes</summary>
                                <ul>
                                    <li>{importSummary.excludedOutsideTargetCities} HVAC taxonomy records were outside the four target city boundaries.</li>
                                    {importSummary.excludedKnownFalsePositives.map((record: { sourceId: string; reason: string }) => (
                                        <li key={record.sourceId}>{record.reason}</li>
                                    ))}
                                </ul>
                            </details>
                        </div>
                    )}
                    <div className="sidebar-footnote"><CircleHelp size={13} /> Dental, veterinary, and auto listings are fictional demo data.</div>
                </aside>

                <section className="map-stage" aria-label="Hampton Roads business map">
                    <div className="map-canvas" ref={mapContainer} />
                    <div className="map-heading">
                        <span className="map-kicker">THE 757, LOCALLY</span>
                        <span className="map-count">{visibleBusinesses.length} places on the map</span>
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
                    {selectedBusiness && <BusinessDetail business={selectedBusiness} onClose={() => setSelectedBusiness(null)} />}
                    <div className="map-demo-stamp">OVERTURE + DEMO DATA</div>
                </section>
            </main>
        </div>
    )
}

function BusinessRow({ business, selected, onSelect, rowRef, distance }: { business: Business; selected: boolean; onSelect: () => void; rowRef: (element: HTMLButtonElement | null) => void; distance: number }) {
    const verified = business.ownership.status === 'verified'
    const isOverture = business.dataSource === 'overture'

    return (
        <button ref={rowRef} type="button" className={`business-row${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
            <span className={`business-symbol business-symbol--${business.category}`}><MapPin size={15} /></span>
            <span className="business-row-copy">
                <span className="business-row-name">{business.name}</span>
                <span className="business-row-meta">
                    {business.neighborhood ? `${business.neighborhood} · ` : ''}{business.city} · {categoryLabels[business.category]} · {distance.toFixed(1)} mi
                    <span className={`record-source record-source--${isOverture ? 'overture' : 'demo'}`}>{isOverture ? 'OVERTURE' : 'DEMO'}</span>
                    {isOverture && business.incompleteFields && business.incompleteFields.length > 0 && (
                        <span className="incomplete-flag" title={`Missing ${business.incompleteFields.join(', ')}`}>INCOMPLETE</span>
                    )}
                </span>
            </span>
            <span className={`row-verification${verified ? ' is-verified' : ''}`} aria-label={verified ? 'Ownership verified in demo record' : 'Ownership unknown'}>
                {verified ? <BadgeCheck size={15} /> : <CircleHelp size={15} />}
            </span>
        </button>
    )
}

function BusinessDetail({ business, onClose }: { business: Business; onClose: () => void }) {
    const ownership = business.ownership
    const isVerified = ownership.status === 'verified'
    const isOverture = business.dataSource === 'overture'

    return (
        <article className="detail-panel" aria-labelledby="detail-title">
            <div className="detail-topline">
                <span className={`detail-demo-tag${isOverture ? ' detail-source-tag' : ''}`}><span /> {isOverture ? 'OVERTURE LISTING' : 'FICTIONAL DEMO'}</span>
                <button type="button" className="icon-button close-detail" onClick={onClose} aria-label="Close business details"><X size={18} /></button>
            </div>
            <div className="detail-heading">
                <span className={`detail-symbol detail-symbol--${business.category}`}><MapPin size={19} /></span>
                <div>
                    <p className="detail-category">{categoryLabels[business.category]} <span>·</span> {business.neighborhood ?? business.city}</p>
                    <h2 id="detail-title">{business.name}</h2>
                </div>
            </div>
            <p className="detail-description">{business.description ?? (isOverture ? 'HVAC service listing from Overture Maps.' : '')}</p>
            <div className="detail-location">
                <span>{business.address || (isOverture ? 'Address not available in this listing' : '')}</span>
                <span>{business.city}, VA</span>
            </div>

            <section className="ownership-card" aria-labelledby="ownership-record-title">
                <div className="ownership-card-title">
                    <Building2 size={16} />
                    <h3 id="ownership-record-title">Ownership record</h3>
                </div>
                <div className={`classification-pill classification-pill--${ownership.classification}`}>
                    {isVerified ? <BadgeCheck size={15} /> : <CircleHelp size={15} />}
                    <span>{ownershipLabels[ownership.classification]}</span>
                    <span>{isVerified ? 'DEMO VERIFIED' : 'NOT VERIFIED'}</span>
                </div>
                {isVerified ? (
                    <>
                        {ownership.relationships.map((relationship) => (
                            <div className="relationship" key={`${relationship.entity}-${relationship.relationship}`}>
                                <span className="relationship-label">{relationship.relationship}</span>
                                <span className="relationship-entity">{relationship.entity}</span>
                                <span className="relationship-date">Verified {formatDate(relationship.verifiedAt)}</span>
                            </div>
                        ))}
                        <div className="evidence-block">
                            <span className="evidence-heading">SUPPORTING DEMO EVIDENCE</span>
                            {ownership.evidence.map((evidence) => (
                                <div className="evidence-row" key={evidence.reference}>
                                    <span>{evidence.source}</span>
                                    <span>{evidence.reference}</span>
                                </div>
                            ))}
                            <span className="record-date">Record checked {formatDate(ownership.verifiedAt)}</span>
                        </div>
                    </>
                ) : (
                    <p className="unknown-note">We don’t have enough verified information to classify this business. Unknown is not an ownership type.</p>
                )}
            </section>
            {isOverture && (
                <section className="source-record" aria-label="Overture source information">
                    <div className="source-record-heading">SOURCE RECORD</div>
                    <a href="https://overturemaps.org/" target="_blank" rel="noreferrer">Overture Maps</a>
                    <span>Place ID: {business.sourceId}</span>
                    {business.sourceDataset && <span>Provider dataset: {business.sourceDataset}{business.sourceRecordId ? ` / ${business.sourceRecordId}` : ''}</span>}
                    <span>Release {business.sourceRelease}</span>
                    {business.incompleteFields && business.incompleteFields.length > 0 && (
                        <span className="incomplete-notice">Incomplete listing: missing {business.incompleteFields.join(', ')}</span>
                    )}
                    {business.website && <a href={business.website} target="_blank" rel="noreferrer">Visit listed website <ArrowUpRight size={13} /></a>}
                </section>
            )}
            {business.phone ? (
                <a className="detail-link" href={`tel:${business.phone.replaceAll('-', '')}`}>
                    Call {business.phone} <ArrowUpRight size={15} />
                </a>
            ) : (
                <p className="unknown-note">Phone number not available in this listing.</p>
            )}
            <div className="detail-disclaimer"><ShieldCheck size={13} />
                {isOverture ? 'Overture listing. Ownership has not been researched or verified.' : 'Fictional demonstration record. Not a real business or ownership claim.'}
            </div>
        </article>
    )
}

function formatDate(date: string | null) {
    if (!date) return 'Not verified'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export default App
