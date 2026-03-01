import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('filePath');
  const targetHost = searchParams.get('targetHost') || 'localhost';
  const targetPort = searchParams.get('targetPort') || '8888';
  const pinCode = searchParams.get('pinCode') || '';

  if (!filePath) {
    return new NextResponse('Missing filePath', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {

      const send = (msg: string) => {
        controller.enqueue(encoder.encode(msg));
      };

      const progressBar = (current: number, total: number, width: number = 30): string => {
        const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
        const filled = Math.round((pct / 100) * width);
        const empty = width - filled;
        return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${pct}%`;
      };

      try {
        // =========================
        // STEP 1: MALWARE SCAN
        // =========================
        send('\n🔍 MALWARE SCAN\n');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        send(`  Target: ${path.basename(filePath)}\n\n`);

        const malwareDir = path.resolve(process.cwd(), '../Malware_Detection-main');

        const pythonProcess = spawn('python', ['malware_scanner.py', filePath], {
          cwd: malwareDir,
          shell: true,
        });

        let malwareDetected = false;
        let totalScanned = 0;
        let safeCount = 0;
        let threatCount = 0;
        let totalScore = 0;
        let lastProgressUpdate = 0;

        for await (const chunk of pythonProcess.stdout) {
          const text = chunk.toString();
          const lines = text.split('\n');

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('Scanning:')) {
              totalScanned++;
              if (totalScanned === 1 || totalScanned - lastProgressUpdate >= 10) {
                lastProgressUpdate = totalScanned;
                send(`\r  Scanning files... ${totalScanned} checked  ${safeCount} safe  ${threatCount} threats\n`);
              }
              continue;
            }

            if (trimmed.startsWith('Verdict:')) {
              const verdict = trimmed.replace('Verdict:', '').trim();
              if (verdict === 'SAFE') safeCount++;
              else { threatCount++; malwareDetected = true; }
              continue;
            }

            if (trimmed.startsWith('Score:')) {
              totalScore += parseInt(trimmed.replace('Score:', '').trim()) || 0;
              continue;
            }

            if (trimmed.includes('ALL FILES SAFE') || trimmed.includes('MALWARE DETECTED') ||
              trimmed.includes('Infected') || trimmed.includes('Total files')) continue;

            if (trimmed.startsWith('Scanning folder:')) {
              send(`  📂 ${trimmed.replace('Scanning folder:', '').trim()}\n`);
              continue;
            }
          }
        }

        for await (const chunk of pythonProcess.stderr) {
          const text = chunk.toString().trim();
          if (text) send(`  ⚠ ${text}\n`);
        }

        await new Promise((resolve) => pythonProcess.on('close', resolve));

        const safePct = totalScanned > 0 ? Math.round((safeCount / totalScanned) * 100) : 100;
        const avgScore = totalScanned > 0 ? Math.round(totalScore / totalScanned) : 0;

        send(`\n  ${progressBar(totalScanned, totalScanned)}\n\n`);
        send(`  📊 Results:\n`);
        send(`     Files scanned:  ${totalScanned}\n`);
        send(`     Safe:           ${safeCount}\n`);
        send(`     Threats:        ${threatCount}\n`);
        send(`     Safety rating:  ${safePct}% clean\n`);
        send(`     Avg risk score: ${avgScore}/100\n\n`);

        if (malwareDetected) {
          send('  🚨 MALWARE DETECTED — TRANSFER ABORTED\n');
          send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          controller.close();
          return;
        }

        send(`  ✅ VERDICT: ALL FILES SAFE (${safePct}%)\n`);
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

        // =========================
        // STEP 2: SECURE TRANSFER (HTTPS)
        // =========================
        send('🔒 SECURE TRANSFER (HTTPS)\n');
        send('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        send(`  Target: ${targetHost}:${targetPort}\n`);
        if (pinCode) send(`  PIN:    ${pinCode}\n`);
        send('\n');

        const nodeDir = path.resolve(process.cwd(), '../ML-Hackathon2-main/In Node.js');

        // client.js <filePath> <host> <port> [pin]
        const clientArgs = ['client.js', filePath, targetHost, targetPort];
        if (pinCode) clientArgs.push(pinCode);

        const clientProcess = spawn(
          'node',
          clientArgs,
          {
            cwd: nodeDir,
            shell: true,
          }
        );

        for await (const chunk of clientProcess.stdout) {
          send(chunk.toString());
        }

        for await (const chunk of clientProcess.stderr) {
          send(`[STDERR] ${chunk.toString()}`);
        }

        await new Promise((resolve) => clientProcess.on('close', resolve));

        send('\n✨ Transfer Complete.\n');
        controller.close();

      } catch (error: any) {
        send(`\n❌ System Error: ${error.message}\n`);
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
