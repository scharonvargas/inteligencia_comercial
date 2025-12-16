/**
 * Google Places API (New) Service
 * 
 * Usa a nova API do Google Places para:
 * 1. Buscar empresas reais por texto/categoria
 * 2. Validar se uma empresa existe
 * 3. Enriquecer dados (rating, reviews, horários, fotos)
 */

export interface PlaceResult {
    placeId: string;
    name: string;
    address: string;
    phone?: string;
    website?: string;
    rating?: number;
    reviewCount?: number;
    priceLevel?: number;
    isOpen?: boolean;
    lat: number;
    lng: number;
    types: string[];
    photos?: string[];
    businessStatus?: string;
}

// Cache para evitar requests repetidas
const placesCache = new Map<string, { data: PlaceResult[], timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

/**
 * Busca empresas usando Google Places Text Search (New)
 */
export async function searchPlaces(
    query: string,
    location?: { lat: number; lng: number },
    radius: number = 5000
): Promise<PlaceResult[]> {
    const apiKey = getPlacesApiKey();
    if (!apiKey) {
        console.warn('[Places] API key não configurada');
        return [];
    }

    // Verifica cache
    const cacheKey = `${query}|${location?.lat || ''}|${location?.lng || ''}`;
    const cached = placesCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log('[Places] Cache hit:', cacheKey);
        return cached.data;
    }

    try {
        // Google Places API (New) - Text Search
        const url = new URL('https://places.googleapis.com/v1/places:searchText');

        const requestBody: any = {
            textQuery: query,
            languageCode: 'pt-BR',
            maxResultCount: 20,
        };

        // Adiciona bias de localização se fornecido
        if (location) {
            requestBody.locationBias = {
                circle: {
                    center: {
                        latitude: location.lat,
                        longitude: location.lng
                    },
                    radius: radius
                }
            };
        }

        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.location,places.types,places.businessStatus'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('[Places] API Error:', response.status, error);
            return [];
        }

        const data = await response.json();

        if (!data.places || data.places.length === 0) {
            console.log('[Places] Nenhum resultado para:', query);
            return [];
        }

        const results: PlaceResult[] = data.places.map((place: any) => ({
            placeId: place.id,
            name: place.displayName?.text || '',
            address: place.formattedAddress || '',
            phone: place.nationalPhoneNumber || undefined,
            website: place.websiteUri || undefined,
            rating: place.rating,
            reviewCount: place.userRatingCount,
            priceLevel: place.priceLevel,
            isOpen: place.currentOpeningHours?.openNow,
            lat: place.location?.latitude,
            lng: place.location?.longitude,
            types: place.types || [],
            businessStatus: place.businessStatus
        }));

        console.log(`[Places] Encontrados ${results.length} resultados para "${query}"`);

        // Salva no cache
        placesCache.set(cacheKey, { data: results, timestamp: Date.now() });

        return results;
    } catch (error: any) {
        console.error('[Places] Erro:', error.message);
        return [];
    }
}

/**
 * Valida se uma empresa existe usando busca por nome e endereço
 */
export async function validateBusiness(
    name: string,
    address: string,
    location?: { lat: number; lng: number }
): Promise<{
    exists: boolean;
    confidence: number;
    googleData?: PlaceResult;
}> {
    const query = `${name} ${address}`;
    const results = await searchPlaces(query, location, 2000);

    if (results.length === 0) {
        return { exists: false, confidence: 30 };
    }

    // Verifica se algum resultado é uma correspondência próxima
    const normalizedName = name.toLowerCase().trim();

    for (const place of results) {
        const placeName = place.name.toLowerCase().trim();

        // Correspondência exata ou fuzzy
        if (placeName === normalizedName ||
            placeName.includes(normalizedName) ||
            normalizedName.includes(placeName)) {
            return {
                exists: true,
                confidence: 95,
                googleData: place
            };
        }
    }

    // Nome não exato mas há empresas similares na área
    return {
        exists: false,
        confidence: 50,
        googleData: results[0] // Retorna o primeiro resultado como sugestão
    };
}

/**
 * Enriquece dados de uma empresa com informações do Google
 */
export async function enrichWithGoogle(business: {
    name: string;
    address: string;
    lat?: number;
    lng?: number;
}): Promise<{
    rating?: number;
    reviewCount?: number;
    phone?: string;
    website?: string;
    isOpen?: boolean;
    verified: boolean;
}> {
    const location = business.lat && business.lng
        ? { lat: business.lat, lng: business.lng }
        : undefined;

    const validation = await validateBusiness(business.name, business.address, location);

    if (validation.exists && validation.googleData) {
        return {
            rating: validation.googleData.rating,
            reviewCount: validation.googleData.reviewCount,
            phone: validation.googleData.phone,
            website: validation.googleData.website,
            isOpen: validation.googleData.isOpen,
            verified: true
        };
    }

    return { verified: false };
}

/**
 * Busca direta por categoria e localização (mais preciso)
 */
export async function searchByCategory(
    category: string,
    location: string
): Promise<PlaceResult[]> {
    const query = `${category} em ${location}`;
    return searchPlaces(query);
}

/**
 * Obtém a chave da API do Places
 * Prioridade: env > localStorage > hardcode dev
 */
function getPlacesApiKey(): string | null {
    // 1. Variável de ambiente
    if (import.meta.env?.VITE_GOOGLE_PLACES_KEY) {
        return import.meta.env.VITE_GOOGLE_PLACES_KEY;
    }

    // 2. localStorage (configurado pelo usuário)
    const storedKey = localStorage.getItem('vericorp_places_key');
    if (storedKey) {
        return storedKey;
    }

    // 3. Chave de desenvolvimento (fornecida pelo usuário)
    if (import.meta.env.DEV) {
        return 'AIzaSyBovz1YzC8NhcXmJDrVUBXnr9sTbj749jk';
    }

    return null;
}

/**
 * Limpa o cache do Places
 */
export function clearPlacesCache(): void {
    placesCache.clear();
    console.log('[Places] Cache limpo');
}
