import { stdout } from 'node:process';
export function writeMessage(payload) {
    const body = JSON.stringify(payload);
    stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}
export function createMessageProcessor(onMessage, onMalformedMessage) {
    let buffer = '';
    return (chunk) => {
        buffer += chunk.toString('utf8');
        while (true) {
            const separatorIndex = buffer.indexOf('\r\n\r\n');
            if (separatorIndex === -1)
                return;
            const header = buffer.slice(0, separatorIndex);
            const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!lengthMatch) {
                buffer = '';
                onMalformedMessage(parseError('Missing Content-Length header'));
                return;
            }
            const contentLength = Number(lengthMatch[1]);
            const start = separatorIndex + 4;
            const end = start + contentLength;
            if (buffer.length < end)
                return;
            const body = buffer.slice(start, end);
            buffer = buffer.slice(end);
            try {
                void onMessage(JSON.parse(body));
            }
            catch {
                onMalformedMessage(parseError('Malformed JSON payload'));
            }
        }
    };
}
function parseError(message) {
    return { jsonrpc: '2.0', id: null, error: { code: -32700, message } };
}
