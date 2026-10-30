import importedHvacData from './overtureHvacListings.json'
import importedDentalData from './overtureDentalListings.json'
import importedVeterinaryData from './overtureVeterinaryListings.json'
import importedAutoRepairData from './overtureAutoRepairListings.json'
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
    transactionType?: string
    scope?: string
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

const unknownOwnership: UnknownOwnershipRecord = {
    classification: 'unknown',
    status: 'unknown',
    verifiedAt: null,
    relationships: [],
    evidence: [],
}

interface PublicOwnershipRecord {
    businessId: string
    entityId: string
    classification: 'private_equity_backed' | 'subsidiary' | 'public_company' | string
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
    transactionType?: string
    scope?: string
    announcedAt?: string | null
    effectiveAt?: string | null
    effectiveYear?: number
    verifiedAt: string
    evidence: Array<{ url: string; description: string; verifiedAt: string }>
}

const publicRecords = (publicOwnershipData as unknown as { records: PublicOwnershipRecord[] }).records
const approvedPublicRecords = new Map(publicRecords
    .filter((record) => record.approvalStatus === 'approved'
        && ['private_equity_backed', 'subsidiary', 'public_company'].includes(record.classification)
        && Boolean(record.verifiedAt && record.approvedAt && record.approvedBy)
        && record.evidence.length > 0
        && record.evidence.every((evidence) => evidence.url.startsWith('https://') && !evidence.url.includes('.invalid')))
    .map((record) => [record.businessId, record]))
const registryEntities = new Map((ownershipRegistryData as unknown as { entities: RegistryEntity[] }).entities.map((entity) => [entity.id, entity]))
const registryRelationships = (ownershipRegistryData as unknown as { relationships: RegistryRelationship[] }).relationships

function ownershipChain(entityId: string): OwnershipChainStep[] {
    const steps: OwnershipChainStep[] = []
    const visited = new Set([entityId])
    let frontier = [entityId]
    for (let depth = 0; depth < 4 && frontier.length; depth += 1) {
        const nextFrontier: string[] = []
        for (const currentId of frontier) {
            for (const relationship of registryRelationships.filter((item) => item.fromEntityId === currentId
                && ['acquired_by', 'majority_investment_by', 'portfolio_company_of', 'formed_through_partnership', 'subsidiary_of', 'owned_by'].includes(item.type)
                && !visited.has(item.toEntityId))) {
                const destination = registryEntities.get(relationship.toEntityId)
                if (!destination) continue
                steps.push({
                    fromEntity: registryEntities.get(currentId)?.name ?? currentId,
                    toEntity: destination.name,
                    relationship: relationship.type,
                    transactionType: relationship.transactionType,
                    scope: relationship.scope,
                    announcedAt: relationship.announcedAt ?? null,
                    effectiveAt: relationship.effectiveAt ?? null,
                    effectiveYear: relationship.effectiveYear,
                    verifiedAt: relationship.verifiedAt,
                    evidence: relationship.evidence,
                })
                visited.add(relationship.toEntityId)
                nextFrontier.push(relationship.toEntityId)
            }
        }
        frontier = nextFrontier
    }
    return steps
}

function publicOwnership(businessId: string): VerifiedOwnershipRecord | null {
    const record = approvedPublicRecords.get(businessId)
    if (!record) return null
    const chain = ownershipChain(record.entityId)
    if (chain.length === 0) return null
    return {
        classification: record.classification === 'private_equity_backed' ? 'pe-backed' : 'corporate',
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
const additionalOvertureBusinesses = ([
    ...importedDentalData.businesses,
    ...importedVeterinaryData.businesses,
    ...importedAutoRepairData.businesses,
 ] as unknown as Omit<Business, 'ownership'>[]).map((business) => ({
        ...business,
        ownership: publicOwnership(business.id) ?? unknownOwnership,
    }))
export const businesses: Business[] = [...importedHvacBusinesses, ...additionalOvertureBusinesses]
