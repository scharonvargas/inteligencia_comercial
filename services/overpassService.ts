/**
 * Serviço Overpass API - Busca empresas REAIS do OpenStreetMap
 * 
 * O Overpass API permite queries complexas no banco de dados OSM,
 * retornando POIs (Points of Interest) como restaurantes, lojas, etc.
 */

export interface OSMBusiness {
    id: number;
    name: string;
    address: string;
    phone: string | null;
    website: string | null;
    lat: number;
    lng: number;
    category: string;
    osmType: 'node' | 'way' | 'relation';
    tags: Record<string, string>;
    verified: true; // Sempre true - dados são reais
    dataSource: 'osm';
}

// Cache simples para evitar requests repetidas
const queryCache = new Map<string, { data: OSMBusiness[], timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutos

// Mapeamento de segmentos para tags OSM
const SEGMENT_TO_OSM_TAGS: Record<string, string[]> = {
    // Alimentação
    'pizzaria': ['amenity=restaurant][cuisine~"pizza"', 'amenity=fast_food][cuisine~"pizza"'],
    'restaurante': ['amenity=restaurant', 'amenity=fast_food'],
    'lanchonete': ['amenity=fast_food', 'amenity=cafe'],
    'padaria': ['shop=bakery', 'amenity=cafe'],
    'bar': ['amenity=bar', 'amenity=pub'],
    'cafeteria': ['amenity=cafe'],
    'açougue': ['shop=butcher'],
    'mercado': ['shop=supermarket', 'shop=convenience'],
    'supermercado': ['shop=supermarket'],

    // Saúde
    'farmácia': ['amenity=pharmacy'],
    'clínica': ['amenity=clinic', 'amenity=doctors'],
    'hospital': ['amenity=hospital'],
    'dentista': ['amenity=dentist'],
    'veterinário': ['amenity=veterinary'],

    // Serviços
    'salão': ['shop=hairdresser', 'shop=beauty'],
    'barbearia': ['shop=hairdresser'],
    'academia': ['leisure=fitness_centre', 'leisure=gym'],
    'oficina': ['shop=car_repair', 'shop=motorcycle_repair'],
    'mecânica': ['shop=car_repair'],
    'lavanderia': ['shop=laundry', 'shop=dry_cleaning'],

    // Comércio
    'loja': ['shop=*'],
    'roupa': ['shop=clothes', 'shop=fashion'],
    'calçado': ['shop=shoes'],
    'móveis': ['shop=furniture'],
    'eletrônicos': ['shop=electronics', 'shop=computer'],
    'papelaria': ['shop=stationery'],
    'livraria': ['shop=books'],
    'pet shop': ['shop=pet'],

    // Educação
    'escola': ['amenity=school'],
    'curso': ['amenity=college', 'amenity=training'],
    'autoescola': ['amenity=driving_school'],

    // Outros
    'hotel': ['tourism=hotel', 'tourism=hostel'],
    'pousada': ['tourism=guest_house', 'tourism=hostel'],
    'posto': ['amenity=fuel'],
    'banco': ['amenity=bank'],
    'correio': ['amenity=post_office'],
};

/**
 * Normaliza o termo de busca para encontrar tags OSM correspondentes
 */
function normalizeSegment(segment: string): string {
    return segment.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .trim();
}

/**
 * Encontra as tags OSM correspondentes ao segmento
 */
function getOSMTagsForSegment(segment: string): string[] {
    const normalized = normalizeSegment(segment);

    // Busca exata primeiro
    if (SEGMENT_TO_OSM_TAGS[normalized]) {
        return SEGMENT_TO_OSM_TAGS[normalized];
    }

    // Busca parcial
    for (const [key, tags] of Object.entries(SEGMENT_TO_OSM_TAGS)) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return tags;
        }
    }

    // Fallback: busca genérica por nome
    return [`name~"${segment}",i`]; // Case insensitive name search
}

/**
 * Constrói a query Overpass para buscar empresas
 */
function buildOverpassQuery(segment: string, locationName: string, limit: number = 50): string {
    const osmTags = getOSMTagsForSegment(segment);

    // Monta as condições de busca
    const tagQueries = osmTags.map(tag => {
        if (tag.includes('=*')) {
            // Wildcard: shop=* → shop
            const key = tag.replace('=*', '');
            return `node["${key}"](area.searchArea);way["${key}"](area.searchArea);`;
        } else if (tag.includes('=')) {
            // Específico: amenity=restaurant
            const [key, value] = tag.split('=');
            // Handle regex values
            if (value.includes('~')) {
                const cleanValue = value.replace(/[\[\]]/g, '');
                return `node[${tag}](area.searchArea);way[${tag}](area.searchArea);`;
            }
            return `node["${key}"="${value}"](area.searchArea);way["${key}"="${value}"](area.searchArea);`;
        } else {
            // Busca por nome
            return `node[${tag}](area.searchArea);way[${tag}](area.searchArea);`;
        }
    }).join('\n');

    // Query Overpass completa
    return `
[out:json][timeout:30];
area["name"~"${locationName}",i]["admin_level"~"^[78]$"]->.searchArea;
(
${tagQueries}
);
out body center ${limit};
`.trim();
}

/**
 * Extrai endereço das tags OSM
 */
function extractAddress(tags: Record<string, string>, lat: number, lon: number): string {
    const parts: string[] = [];

    if (tags['addr:street']) {
        let street = tags['addr:street'];
        if (tags['addr:housenumber']) {
            street += ', ' + tags['addr:housenumber'];
        }
        parts.push(street);
    }

    if (tags['addr:suburb'] || tags['addr:neighbourhood']) {
        parts.push(tags['addr:suburb'] || tags['addr:neighbourhood']);
    }

    if (tags['addr:city']) {
        parts.push(tags['addr:city']);
    }

    if (tags['addr:state']) {
        parts.push(tags['addr:state']);
    }

    // Se não tiver endereço, retorna coordenadas
    if (parts.length === 0) {
        return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }

    return parts.join(', ');
}

/**
 * Extrai categoria das tags OSM
 */
function extractCategory(tags: Record<string, string>): string {
    // Prioridade: cuisine > shop > amenity > tourism
    if (tags.cuisine) {
        return tags.cuisine.split(';')[0].replace('_', ' ');
    }
    if (tags.shop) {
        return tags.shop.replace('_', ' ');
    }
    if (tags.amenity) {
        return tags.amenity.replace('_', ' ');
    }
    if (tags.tourism) {
        return tags.tourism.replace('_', ' ');
    }
    return 'Estabelecimento';
}

/**
 * Busca empresas reais no OpenStreetMap via Overpass API
 */
export async function searchRealBusinesses(
    segment: string,
    location: string,
    limit: number = 50
): Promise<OSMBusiness[]> {
    // Verifica cache
    const cacheKey = `${segment}|${location}|${limit}`;
    const cached = queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[Overpass] Cache hit:', cacheKey);
        return cached.data;
    }

    const query = buildOverpassQuery(segment, location, limit);
    console.log('[Overpass] Query:', query.substring(0, 200) + '...');

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `data=${encodeURIComponent(query)}`,
        });

        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.elements || data.elements.length === 0) {
            console.log('[Overpass] Nenhum resultado encontrado');
            return [];
        }

        const businesses: OSMBusiness[] = data.elements
            .filter((el: any) => el.tags && el.tags.name) // Só elementos com nome
            .map((el: any) => {
                const lat = el.lat || el.center?.lat;
                const lng = el.lon || el.center?.lon;

                return {
                    id: el.id,
                    name: el.tags.name,
                    address: extractAddress(el.tags, lat, lng),
                    phone: el.tags.phone || el.tags['contact:phone'] || null,
                    website: el.tags.website || el.tags['contact:website'] || null,
                    lat,
                    lng,
                    category: extractCategory(el.tags),
                    osmType: el.type,
                    tags: el.tags,
                    verified: true as const,
                    dataSource: 'osm' as const,
                };
            });

        console.log(`[Overpass] Encontrados ${businesses.length} resultados reais`);

        // Salva no cache
        queryCache.set(cacheKey, { data: businesses, timestamp: Date.now() });

        return businesses;
    } catch (error: any) {
        console.error('[Overpass] Erro:', error.message);
        return [];
    }
}

/**
 * Limpa o cache do Overpass
 */
export function clearOverpassCache(): void {
    queryCache.clear();
    console.log('[Overpass] Cache limpo');
}
