export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    const url = new URL(req.url);
    const apiKey = process.env.API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Server API Key not configured' }), { status: 500 });
    }

    // Forward query params (address, latlng, etc)
    const queryParams = url.searchParams;
    queryParams.set('key', apiKey); // Inject key securely

    // Determine if it is reverse (latlng) or forward (address)
    // The frontend sends standard google params
    // API URL: https://maps.googleapis.com/maps/api/geocode/json

    const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?${queryParams.toString()}`;

    try {
        const googleRes = await fetch(googleUrl);
        const data = await googleRes.json();
        return new Response(JSON.stringify(data), {
            status: googleRes.status,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
