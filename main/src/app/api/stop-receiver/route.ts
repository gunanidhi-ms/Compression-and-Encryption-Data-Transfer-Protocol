import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const platform = os.platform();

        // Kill any active server processes
        if (platform === 'win32') {
            exec('wmic process where "name=\'node.exe\' and commandline like \'%server.js%\'" call terminate', { timeout: 5000 }, () => { });
        } else {
            exec('pkill -f "server.js"', { timeout: 5000 }, () => { });
        }

        return NextResponse.json({ status: 'stopped' });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
