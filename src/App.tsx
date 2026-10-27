import { useEffect, useRef, useState } from 'react'
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
    ownershipLabels,
    type Business,
    type BusinessCategory,
    type OwnershipClassification,
} from './businesses'
import { localRoads, localWater } from './hamptonRoadsMap'
import 'maplibre-gl/dist/maplibre-gl.css'

const categories = Object.keys(categoryLabels) as BusinessCategory[]
const ownershipTypes = Object.keys(ownershipLabels) as OwnershipClassification[]
maplibregl.setWorkerUrl(maplibreWorkerUrl)

function App() {
    const mapContainer = useRef<HTMLDivElement>(null)
    const map = useRef<maplibregl.Map | null>(null)
    const markers = useRef<Marker[]>([])
    const contextMarkers = useRef<Marker[]>([])
    const [activeCategories, setActiveCategories] = useState<BusinessCategory[]>(categories)
    const [activeOwnership, setActiveOwnership] = useState<OwnershipClassification[]>(ownershipTypes)
    const [search, setSearch] = useState('')
    const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
    const [mapUnavailable, setMapUnavailable] = useState<string | null>(null)

    const visibleBusinesses = businesses.filter((business) => {
        const matchesCategory = activeCategories.includes(business.category)
        const matchesOwnership = activeOwnership.includes(business.ownership.classification)
        const searchText = `${business.name} ${business.city} ${business.neighborhood}`.toLowerCase()
        return matchesCategory && matchesOwnership && searchText.includes(search.trim().toLowerCase())
    })

    useEffect(() => {
        if (!mapContainer.current) return

        const instance = new maplibregl.Map({
            container: mapContainer.current,
            style: {
                version: 8,
                sources: {},
                layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#f1efe4' } }],
            },
            center: [-76.36, 36.91],
            zoom: 9.05,
            minZoom: 7.5,
            maxZoom: 16,
            attributionControl: false,
        })

        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
        instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
        instance.on('load', () => {
            instance.addSource('local-water', { type: 'geojson', data: localWater })
            instance.addLayer({
                id: 'water-fill',
                type: 'fill',
                source: 'local-water',
                paint: { 'fill-color': '#d7e6e2', 'fill-opacity': 1 },
            })
            instance.addSource('local-roads', { type: 'geojson', data: localRoads })
            instance.addLayer({
                id: 'road-casing',
                type: 'line',
                source: 'local-roads',
                paint: { 'line-color': '#dedbcf', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 12, 6] },
            })
            instance.addLayer({
                id: 'road-lines',
                type: 'line',
                source: 'local-roads',
                paint: { 'line-color': '#fffdf7', 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 3.5] },
            })
            setMapUnavailable(null)
        })
        instance.on('error', (event) => setMapUnavailable(event.error.message))
        map.current = instance
        contextMarkers.current = [
            { label: 'HAMPTON', lng: -76.35, lat: 37.03 },
            { label: 'NEWPORT NEWS', lng: -76.43, lat: 37.06 },
            { label: 'NORFOLK', lng: -76.27, lat: 36.9 },
            { label: 'PORTSMOUTH', lng: -76.31, lat: 36.82 },
            { label: 'CHESAPEAKE', lng: -76.31, lat: 36.74 },
            { label: 'VIRGINIA BEACH', lng: -76.08, lat: 36.89 },
            { label: 'CHESAPEAKE BAY', lng: -76.49, lat: 37.01, water: true },
            { label: 'ATLANTIC OCEAN', lng: -75.99, lat: 36.99, water: true },
        ].map(({ label, lng, lat, water }) => {
            const element = document.createElement('div')
            element.className = water ? 'map-water-label' : 'map-place-label'
            element.textContent = label
            return new maplibregl.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(instance)
        })

        return () => {
            markers.current.forEach((marker) => marker.remove())
            contextMarkers.current.forEach((marker) => marker.remove())
            markers.current = []
            contextMarkers.current = []
            instance.remove()
            map.current = null
        }
    }, [])

    useEffect(() => {
        if (!map.current) return

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
    }, [visibleBusinesses, selectedBusiness])

    const toggleCategory = (category: BusinessCategory) => {
        setActiveCategories((current) => current.includes(category)
            ? current.filter((value) => value !== category)
            : [...current, category])
    }

    const toggleOwnership = (classification: OwnershipClassification) => {
        setActiveOwnership((current) => current.includes(classification)
            ? current.filter((value) => value !== classification)
            : [...current, classification])
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
                <div className="demo-label"><span /> DEMO DIRECTORY</div>
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
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search a business or city"
                            aria-label="Search businesses or cities"
                        />
                        {search && <button type="button" className="clear-search" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
                    </label>

                    <section className="filter-section" aria-labelledby="category-heading">
                        <div className="section-label"><SlidersHorizontal size={14} /><h2 id="category-heading">What do you need?</h2></div>
                        <div className="category-filters">
                            {categories.map((category) => (
                                <button
                                    type="button"
                                    key={category}
                                    className={`category-filter${activeCategories.includes(category) ? ' is-active' : ''}`}
                                    aria-pressed={activeCategories.includes(category)}
                                    onClick={() => toggleCategory(category)}
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
                            <h2 id="results-heading">Around here <span>{visibleBusinesses.length}</span></h2>
                            <span className="results-caption">DEMO BUSINESSES</span>
                        </div>
                        <div className="business-list">
                            {visibleBusinesses.map((business) => (
                                <BusinessRow
                                    business={business}
                                    key={business.id}
                                    selected={selectedBusiness?.id === business.id}
                                    onSelect={() => chooseBusiness(business)}
                                />
                            ))}
                            {visibleBusinesses.length === 0 && <p className="empty-results">No matches. Try widening your filters.</p>}
                        </div>
                    </section>
                    <div className="sidebar-footnote"><CircleHelp size={13} /> All names and ownership records are fictional demo data.</div>
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
                        aria-label="Show all businesses on the map"
                        title="Show all businesses"
                        onClick={() => map.current?.flyTo({ center: [-76.36, 36.91], zoom: 9.05, duration: 650 })}
                    >
                        <LocateFixed size={17} />
                    </button>
                    {mapUnavailable && <div className="map-message">The interactive map is unavailable: {mapUnavailable}</div>}
                    {selectedBusiness && <BusinessDetail business={selectedBusiness} onClose={() => setSelectedBusiness(null)} />}
                    <div className="map-demo-stamp">FICTIONAL DEMO DATA</div>
                </section>
            </main>
        </div>
    )
}

function BusinessRow({ business, selected, onSelect }: { business: Business; selected: boolean; onSelect: () => void }) {
    const verified = business.ownership.status === 'verified'

    return (
        <button type="button" className={`business-row${selected ? ' is-selected' : ''}`} onClick={onSelect}>
            <span className={`business-symbol business-symbol--${business.category}`}><MapPin size={15} /></span>
            <span className="business-row-copy">
                <span className="business-row-name">{business.name}</span>
                <span className="business-row-meta">{business.neighborhood} <span>·</span> {categoryLabels[business.category]}</span>
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

    return (
        <article className="detail-panel" aria-labelledby="detail-title">
            <div className="detail-topline">
                <span className="detail-demo-tag"><span /> FICTIONAL DEMO</span>
                <button type="button" className="icon-button close-detail" onClick={onClose} aria-label="Close business details"><X size={18} /></button>
            </div>
            <div className="detail-heading">
                <span className={`detail-symbol detail-symbol--${business.category}`}><MapPin size={19} /></span>
                <div>
                    <p className="detail-category">{categoryLabels[business.category]} <span>·</span> {business.neighborhood}</p>
                    <h2 id="detail-title">{business.name}</h2>
                </div>
            </div>
            <p className="detail-description">{business.description}</p>
            <div className="detail-location"><span>{business.address}</span><span>{business.city}, VA</span></div>

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
            <a className="detail-link" href={`tel:${business.phone.replaceAll('-', '')}`}>
                Call {business.phone} <ArrowUpRight size={15} />
            </a>
            <div className="detail-disclaimer"><ShieldCheck size={13} /> Demonstration record. Not a real business or ownership claim.</div>
        </article>
    )
}

function formatDate(date: string | null) {
    if (!date) return 'Not verified'
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))
}

export default App
