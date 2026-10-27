export type BusinessCategory = 'hvac' | 'dental' | 'veterinary' | 'automotive'
export type OwnershipClassification = 'pe-backed' | 'independent' | 'corporate' | 'unknown'

export interface OwnershipEvidence {
    source: string
    reference: string
}

export interface OwnershipRelationship {
    entity: string
    relationship: string
    verifiedAt: string
}

interface VerifiedOwnershipRecord {
    classification: Exclude<OwnershipClassification, 'unknown'>
    status: 'verified'
    verifiedAt: string
    relationships: OwnershipRelationship[]
    evidence: OwnershipEvidence[]
}

interface UnknownOwnershipRecord {
    classification: 'unknown'
    status: 'unknown'
    verifiedAt: null
    relationships: []
    evidence: []
}

export type OwnershipRecord = VerifiedOwnershipRecord | UnknownOwnershipRecord

export interface Business {
    id: string
    name: string
    category: BusinessCategory
    address: string
    neighborhood: string
    city: string
    latitude: number
    longitude: number
    phone: string
    description: string
    ownership: OwnershipRecord
}

export const categoryLabels: Record<BusinessCategory, string> = {
    hvac: 'HVAC',
    dental: 'Dental',
    veterinary: 'Veterinary',
    automotive: 'Auto repair',
}

export const ownershipLabels: Record<OwnershipClassification, string> = {
    'pe-backed': 'Verified PE-backed',
    independent: 'Verified independent',
    corporate: 'Other corporate',
    unknown: 'Unknown',
}

const demoEvidence = (reference: string): OwnershipEvidence[] => [
    { source: 'Fictional demo ownership file', reference },
    { source: 'Fictional demo entity record', reference: `DEMO-${reference}` },
]

const verifiedOwnership = (
    classification: Exclude<OwnershipClassification, 'unknown'>,
    entity: string,
    relationship: string,
    verifiedAt: string,
    reference: string,
): VerifiedOwnershipRecord => ({
    classification,
    status: 'verified',
    verifiedAt,
    relationships: [{ entity, relationship, verifiedAt }],
    evidence: demoEvidence(reference),
})

const unknownOwnership: UnknownOwnershipRecord = {
    classification: 'unknown',
    status: 'unknown',
    verifiedAt: null,
    relationships: [],
    evidence: [],
}

export const businesses: Business[] = [
    {
        id: 'tidewater-comfort-co', name: 'Tidewater Comfort Co.', category: 'hvac',
        address: '418 Colley Avenue', neighborhood: 'Ghent', city: 'Norfolk', latitude: 36.8608, longitude: -76.2926,
        phone: '757-555-0101', description: 'Heating and cooling tune-ups, repairs, and replacements from a neighborhood crew.',
        ownership: verifiedOwnership('independent', 'Mara Ellison', 'Founder-owned', '2026-09-12', 'TIDE-001'),
    },
    {
        id: 'harborlight-heating', name: 'Harborlight Heating & Air', category: 'hvac',
        address: '2317 Hampton Highway', neighborhood: 'Phoebus', city: 'Hampton', latitude: 37.0181, longitude: -76.3164,
        phone: '757-555-0102', description: 'Residential HVAC service with an emphasis on efficient seasonal maintenance.',
        ownership: verifiedOwnership('pe-backed', 'Common Current Home Services', 'Platform subsidiary', '2026-08-28', 'HARBOR-014'),
    },
    {
        id: 'blue-heron-mechanical', name: 'Blue Heron Mechanical', category: 'hvac',
        address: '1208 Battlefield Boulevard N', neighborhood: 'Great Bridge', city: 'Chesapeake', latitude: 36.7421, longitude: -76.2387,
        phone: '757-555-0103', description: 'Local technicians for home comfort, ductwork, and indoor air quality.',
        ownership: unknownOwnership,
    },
    {
        id: 'shoreline-smiles', name: 'Shoreline Family Dentistry', category: 'dental',
        address: '730 W 21st Street', neighborhood: 'Park Place', city: 'Norfolk', latitude: 36.8714, longitude: -76.2922,
        phone: '757-555-0104', description: 'Preventive and restorative care for the whole family, close to the neighborhood.',
        ownership: verifiedOwnership('independent', 'Dr. Rowan Pike', 'Dentist-owned practice', '2026-09-02', 'SHORE-008'),
    },
    {
        id: 'juniper-dental-studio', name: 'Juniper Dental Studio', category: 'dental',
        address: '1128 Independence Boulevard', neighborhood: 'Town Center', city: 'Virginia Beach', latitude: 36.8432, longitude: -76.1325,
        phone: '757-555-0105', description: 'Modern general dentistry with unhurried visits and clear treatment plans.',
        ownership: verifiedOwnership('corporate', 'Juniper Care Partners', 'Practice subsidiary', '2026-07-19', 'JUNI-022'),
    },
    {
        id: 'first-landing-dental', name: 'First Landing Dental Care', category: 'dental',
        address: '4000 Virginia Beach Boulevard', neighborhood: 'Central Virginia Beach', city: 'Virginia Beach', latitude: 36.8508, longitude: -76.1027,
        phone: '757-555-0106', description: 'Everyday dental care, from cleanings to restorative treatment.',
        ownership: unknownOwnership,
    },
    {
        id: 'paws-and-pines', name: 'Paws & Pines Veterinary', category: 'veterinary',
        address: '1553 Laskin Road', neighborhood: 'North End', city: 'Virginia Beach', latitude: 36.8587, longitude: -76.0015,
        phone: '757-555-0107', description: 'Thoughtful wellness visits and preventive care for dogs and cats.',
        ownership: verifiedOwnership('independent', 'Dr. Simone Hart', 'Veterinarian-owned clinic', '2026-10-01', 'PAWS-003'),
    },
    {
        id: 'marshview-animal-clinic', name: 'Marshview Animal Clinic', category: 'veterinary',
        address: '825 Battlefield Boulevard S', neighborhood: 'Great Bridge', city: 'Chesapeake', latitude: 36.7061, longitude: -76.2394,
        phone: '757-555-0108', description: 'Compassionate veterinary visits, diagnostics, and routine procedures.',
        ownership: verifiedOwnership('pe-backed', 'Kindred Veterinary Group', 'Clinic member', '2026-09-25', 'MARSH-017'),
    },
    {
        id: 'little-creek-vet', name: 'Little Creek Veterinary House', category: 'veterinary',
        address: '1247 Norview Avenue', neighborhood: 'Little Creek', city: 'Norfolk', latitude: 36.9184, longitude: -76.2094,
        phone: '757-555-0109', description: 'A small-animal clinic for routine care, new-pet visits, and advice.',
        ownership: unknownOwnership,
    },
    {
        id: 'granby-garage', name: 'Granby Street Garage', category: 'automotive',
        address: '1812 Granby Street', neighborhood: 'Ghent', city: 'Norfolk', latitude: 36.8724, longitude: -76.2851,
        phone: '757-555-0110', description: 'Independent auto repair for diagnostics, maintenance, and brakes.',
        ownership: verifiedOwnership('independent', 'Elias & June Mercer', 'Family-owned shop', '2026-09-18', 'GRAN-006'),
    },
    {
        id: 'bay-bridge-auto', name: 'Bay Bridge Auto Works', category: 'automotive',
        address: '8 W Mercury Boulevard', neighborhood: 'Downtown Hampton', city: 'Hampton', latitude: 37.0292, longitude: -76.3444,
        phone: '757-555-0111', description: 'Routine service and repair for cars and light trucks.',
        ownership: verifiedOwnership('corporate', 'Bay Bridge Mobility LLC', 'Operating subsidiary', '2026-08-06', 'BAYB-011'),
    },
    {
        id: 'ocean-view-motor', name: 'Ocean View Motor Works', category: 'automotive',
        address: '9645 1st View Street', neighborhood: 'Ocean View', city: 'Norfolk', latitude: 36.9261, longitude: -76.2432,
        phone: '757-555-0112', description: 'Straightforward maintenance and repair from a long-standing local team.',
        ownership: verifiedOwnership('independent', 'Caleb Wynn', 'Owner-operated shop', '2026-10-05', 'OCEAN-004'),
    },
    {
        id: 'greenbrier-car-care', name: 'Greenbrier Car Care', category: 'automotive',
        address: '1400 Greenbrier Parkway', neighborhood: 'Greenbrier', city: 'Chesapeake', latitude: 36.7871, longitude: -76.2241,
        phone: '757-555-0113', description: 'Scheduled maintenance, inspections, and general automotive repair.',
        ownership: unknownOwnership,
    },
    {
        id: 'willow-oak-heating', name: 'Willow Oak Heating & Cooling', category: 'hvac',
        address: '2208 Princess Anne Road', neighborhood: 'Kempsville', city: 'Virginia Beach', latitude: 36.8158, longitude: -76.1042,
        phone: '757-555-0114', description: 'Heating and cooling service for homes across the south side.',
        ownership: verifiedOwnership('pe-backed', 'Common Current Home Services', 'Platform subsidiary', '2026-08-28', 'WILLOW-019'),
    },
    {
        id: 'anchor-point-dental', name: 'Anchor Point Dental', category: 'dental',
        address: '525 Independence Parkway', neighborhood: 'Greenbrier', city: 'Chesapeake', latitude: 36.7792, longitude: -76.2386,
        phone: '757-555-0115', description: 'Preventive, cosmetic, and family dental care in a relaxed setting.',
        ownership: verifiedOwnership('pe-backed', 'Harborview Dental Collective', 'Practice affiliate', '2026-09-09', 'ANCHOR-031'),
    },
    {
        id: 'cedar-creek-vet', name: 'Cedar Creek Veterinary Care', category: 'veterinary',
        address: '2929 S Military Highway', neighborhood: 'Deep Creek', city: 'Chesapeake', latitude: 36.7526, longitude: -76.3181,
        phone: '757-555-0116', description: 'Wellness and general veterinary care for the pets in your family.',
        ownership: verifiedOwnership('independent', 'Dr. Avery Chen', 'Veterinarian-owned clinic', '2026-09-30', 'CEDAR-012'),
    },
]
