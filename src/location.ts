import zipCentroidData from './hamptonRoadsZipCentroids.json'

export interface LocationPoint {
    latitude: number
    longitude: number
}

export interface SearchCenter extends LocationPoint {
    label: string
}

export interface ZipCentroid extends LocationPoint {
    city: string
}

export const supportedZipCentroids = zipCentroidData.centroids as Record<string, ZipCentroid>
export const zipCentroidSource = zipCentroidData.source

export function distanceMiles(start: LocationPoint, end: LocationPoint): number {
    const radians = (degrees: number) => degrees * Math.PI / 180
    const latitudeDelta = radians(end.latitude - start.latitude)
    const longitudeDelta = radians(end.longitude - start.longitude)
    const startLatitude = radians(start.latitude)
    const endLatitude = radians(end.latitude)
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2
    return 3958.7613 * 2 * Math.asin(Math.sqrt(haversine))
}
