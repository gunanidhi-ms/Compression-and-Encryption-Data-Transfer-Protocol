import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

function getLocalIPs(): string[] {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]!) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }
    return addresses;
}

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const pin = searchParams.get('pin') || '';
    const savePath = searchParams.get('savePath') || '';

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const send = (msg: string) => {
                controller.enqueue(encoder.encode(msg));
            };

            try {
                const nodeDir = process.env.CETP_NODE_DIR || path.resolve(process.cwd(), '../ML-Hackathon2-main/In Node.js');

                send(`\n📡 Starting CETP WebRTC Receiver...\n`);
                if (pin) {
                    send(`🔑 PIN set: ${pin}\n`);
                }
                if (savePath) {
                    send(`📁 Save location: ${savePath}\n`);
                }
                send(`⏳ Connecting to global network...\n\n`);

                const serverArgs: string[] = [];
                if (pin) {
                    serverArgs.push('--pin', pin);
                }
                if (savePath) {
                    serverArgs.push('"' + savePath + '"');
                }

                const spawnEnv = { ...process.env };
                if (process.env.CETP_NODE_PATH) {
                    spawnEnv.NODE_PATH = process.env.CETP_NODE_PATH;
                }

                const serverProcess = spawn(
                    'node',
                    ['server.js', ...serverArgs],
                    {
                        cwd: nodeDir,
                        shell: true,
                        env: spawnEnv
                    }
                );

                for await (const chunk of serverProcess.stdout) {
                    send(chunk.toString());
                }

                for await (const chunk of serverProcess.stderr) {
                    send(`[STDERR] ${chunk.toString()}`);
                }

                await new Promise((resolve) => serverProcess.on('close', resolve));

                send('\n📴 Receiver stopped.\n');
                controller.close();

            } catch (error: any) {
                send(`\n❌ Error: ${error.message}\n`);
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Transfer-Encoding': 'chunked',
        },
    });
}
