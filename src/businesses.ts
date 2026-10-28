import importedHvacData from './overtureHvacListings.json'
import publicOwnershipData from '../data/publicOwnership.json'
import ownershipRegistryData from '../data/realOwnershipRegistry.json'

export type BusinessCategory = 'hvac' | 'dental' | 'veterinary' | 'automotive'
export type OwnershipClassification = 'pe-backed' | 'independent' | 'corporate' | 'unknown'

export interface OwnershipEvidence {
    source: string
    reference: string
    url?: string
    description?: string
}

export interface OwnershipRelationship {
    entity: string
    relationship: string
    verifiedAt: string
}

export interface OwnershipChainStep {
    fromEntity: string
    toEntity: string
    relationship: string
    announcedAt: string | null
    effectiveAt: string | null
    effectiveYear?: number
    verifiedAt: string
    evidence: Array<{ url: string; description: string; verifiedAt: string }>
}

interface VerifiedOwnershipRecord {
    classification: Exclude<OwnershipClassification, 'unknown'>
    status: 'verified'
    verifiedAt: string
    relationships: OwnershipRelationship[]
    evidence: OwnershipEvidence[]
    approvalStatus?: 'approved'
    approvedAt?: string
    approvedBy?: string
    matchConfidence?: number
    matchReasons?: string[]
    ownershipChain?: OwnershipChainStep[]
}

export interface UnknownOwnershipRecord {
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
    address: string | null
    neighborhood?: string
    city: string
    latitude: number
    longitude: number
    phone?: string | null
    description?: string
    website?: string | null
    dataSource?: 'demo' | 'overture'
    sourceId?: string | null
    sourceDataset?: string | null
    sourceRecordId?: string | null
    sourceRelease?: string
    incompleteFields?: string[]
    ownership: OwnershipRecord
}

export interface OvertureBusiness extends Omit<Business, 'category' | 'dataSource' | 'ownership'> {
    category: 'hvac'
    dataSource: 'overture'
    sourceId: string
    sourceRelease: string
    overtureTaxonomyPrimary: string
    overtureMatchReason: string
    ownership: UnknownOwnershipRecord
}

export const categoryLabels: Record<BusinessCategory, string> = {
    hvac: 'HVAC',
    dental: 'Dental',
    veterinary: 'Veterinary',
    automotive: 'Auto Repair',
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

const demoBusinesses: Business[] = [
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

interface PublicOwnershipRecord {
    businessId: string
    entityId: string
    classification: string
    approvalStatus: string
    verifiedAt: string
    approvedAt: string
    approvedBy: string
    matchConfidence?: number
    matchReasons?: string[]
    evidence: Array<{ url: string; description: string }>
}

interface RegistryEntity { id: string; name: string }
interface RegistryRelationship {
    fromEntityId: string
    toEntityId: string
    type: string
    announcedAt?: string | null
    effectiveAt?: string | null
    effectiveYear?: number
    verifiedAt: string
    evidence: Array<{ url: string; description: string; verifiedAt: string }>
}

const publicRecords = (publicOwnershipData as unknown as { records: PublicOwnershipRecord[] }).records
const approvedPublicRecords = new Map(publicRecords
    .filter((record) => record.approvalStatus === 'approved'
        && record.classification === 'private_equity_backed'
        && Boolean(record.verifiedAt && record.approvedAt && record.approvedBy)
        && record.evidence.length > 0
        && record.evidence.every((evidence) => evidence.url.startsWith('https://') && !evidence.url.includes('.invalid')))
    .map((record) => [record.businessId, record]))
const registryEntities = new Map((ownershipRegistryData as unknown as { entities: RegistryEntity[] }).entities.map((entity) => [entity.id, entity]))
const registryRelationships = (ownershipRegistryData as unknown as { relationships: RegistryRelationship[] }).relationships

function ownershipChain(entityId: string): OwnershipChainStep[] {
    const steps: OwnershipChainStep[] = []
    const visited = new Set([entityId])
    let currentId = entityId
    for (let depth = 0; depth < 4; depth += 1) {
        const relationship = registryRelationships.find((item) => item.fromEntityId === currentId
            && ['acquired_by', 'majority_investment_by', 'portfolio_company_of'].includes(item.type)
            && !visited.has(item.toEntityId))
        if (!relationship) break
        const destination = registryEntities.get(relationship.toEntityId)
        if (!destination) break
        steps.push({
            fromEntity: registryEntities.get(currentId)?.name ?? currentId,
            toEntity: destination.name,
            relationship: relationship.type,
            announcedAt: relationship.announcedAt ?? null,
            effectiveAt: relationship.effectiveAt ?? null,
            effectiveYear: relationship.effectiveYear,
            verifiedAt: relationship.verifiedAt,
            evidence: relationship.evidence,
        })
        currentId = relationship.toEntityId
        visited.add(currentId)
    }
    return steps
}

function publicOwnership(businessId: string): VerifiedOwnershipRecord | null {
    const record = approvedPublicRecords.get(businessId)
    if (!record) return null
    const chain = ownershipChain(record.entityId)
    if (chain.length === 0) return null
    return {
        classification: 'pe-backed',
        status: 'verified',
        verifiedAt: record.verifiedAt,
        relationships: [],
        evidence: record.evidence.map((item) => ({ source: item.description, reference: item.url, url: item.url, description: item.description })),
        approvalStatus: 'approved',
        approvedAt: record.approvedAt,
        approvedBy: record.approvedBy,
        matchConfidence: record.matchConfidence,
        matchReasons: record.matchReasons,
        ownershipChain: chain,
    }
}

export const importedHvacBusinesses = (importedHvacData.businesses as unknown as OvertureBusiness[]).map((business) => ({
    ...business,
    ownership: publicOwnership(business.id) ?? unknownOwnership,
}))
export const importSummary = importedHvacData.summary
export const businesses: Business[] = [...importedHvacBusinesses, ...demoBusinesses]
