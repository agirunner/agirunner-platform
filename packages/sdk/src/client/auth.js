export async function exchangeApiKey(transport, apiKey, persistentSession = true) {
    const response = await transport.request('/api/v1/auth/token', {
        method: 'POST',
        body: {
            api_key: apiKey,
            persistent_session: persistentSession,
        },
        includeAuth: false,
    });
    return response.data;
}
export async function refreshSession(transport) {
    const response = await transport.request('/api/v1/auth/refresh', {
        method: 'POST',
        includeAuth: false,
    });
    return response.data;
}
