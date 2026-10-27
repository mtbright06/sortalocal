type Coordinate = [number, number]

interface MapFeature {
    type: 'Feature'
    properties: Record<string, string>
    geometry: {
        type: 'LineString' | 'Polygon'
        coordinates: Coordinate[] | Coordinate[][]
    }
}

interface FeatureCollection {
    type: 'FeatureCollection'
    features: MapFeature[]
}

export const localWater: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: { name: 'Chesapeake Bay' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-76.58, 37.14], [-76.39, 37.14], [-76.35, 37.07], [-76.39, 37.02],
                    [-76.43, 36.99], [-76.46, 36.95], [-76.5, 36.91], [-76.58, 36.88], [-76.58, 37.14],
                ]],
            },
        },
        {
            type: 'Feature',
            properties: { name: 'Hampton Roads Harbor' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-76.49, 36.97], [-76.44, 36.96], [-76.4, 36.94], [-76.36, 36.92],
                    [-76.32, 36.92], [-76.29, 36.94], [-76.25, 36.95], [-76.22, 36.93],
                    [-76.24, 36.9], [-76.28, 36.89], [-76.32, 36.9], [-76.37, 36.91],
                    [-76.42, 36.93], [-76.47, 36.94], [-76.49, 36.97],
                ]],
            },
        },
        {
            type: 'Feature',
            properties: { name: 'Atlantic Ocean' },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [-76.01, 37.14], [-75.86, 37.14], [-75.86, 36.59], [-76.0, 36.59],
                    [-75.98, 36.7], [-75.99, 36.8], [-76.02, 36.89], [-76.01, 37.14],
                ]],
            },
        },
    ],
}

export const localRoads: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            properties: { route: 'I-64' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.48, 37.08], [-76.43, 37.06], [-76.4, 37.02], [-76.36, 36.99],
                    [-76.32, 36.96], [-76.29, 36.93], [-76.27, 36.9], [-76.23, 36.88],
                    [-76.19, 36.87], [-76.14, 36.87], [-76.1, 36.88], [-76.06, 36.91],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'I-264' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.36, 36.88], [-76.32, 36.87], [-76.28, 36.86], [-76.24, 36.85],
                    [-76.2, 36.85], [-76.16, 36.86], [-76.12, 36.87], [-76.08, 36.88],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'I-664' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.43, 37.04], [-76.45, 37.0], [-76.45, 36.96], [-76.43, 36.92],
                    [-76.42, 36.88], [-76.4, 36.84], [-76.37, 36.8], [-76.35, 36.76],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'US-13' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.28, 37.08], [-76.29, 37.03], [-76.28, 36.99], [-76.26, 36.95],
                    [-76.24, 36.91], [-76.21, 36.88], [-76.18, 36.85], [-76.15, 36.81],
                    [-76.13, 36.77], [-76.11, 36.72],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'Local roads' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.4, 36.95], [-76.36, 36.94], [-76.32, 36.93], [-76.28, 36.93],
                    [-76.24, 36.94], [-76.2, 36.95], [-76.16, 36.94], [-76.12, 36.93],
                    [-76.08, 36.92],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'Local roads' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.37, 36.9], [-76.34, 36.88], [-76.31, 36.86], [-76.28, 36.84],
                    [-76.25, 36.82], [-76.22, 36.8], [-76.19, 36.78], [-76.16, 36.76],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'Local roads' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.35, 37.04], [-76.33, 37.0], [-76.31, 36.97], [-76.3, 36.93],
                    [-76.29, 36.89], [-76.29, 36.85], [-76.29, 36.81], [-76.3, 36.77],
                ]
            },
        },
        {
            type: 'Feature',
            properties: { route: 'Local roads' },
            geometry: {
                type: 'LineString', coordinates: [
                    [-76.22, 37.05], [-76.2, 37.01], [-76.19, 36.97], [-76.18, 36.93],
                    [-76.17, 36.89], [-76.16, 36.85], [-76.15, 36.81], [-76.14, 36.77],
                ]
            },
        },
    ],
}
