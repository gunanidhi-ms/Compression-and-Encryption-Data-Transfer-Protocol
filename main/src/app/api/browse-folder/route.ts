import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const platform = os.platform();
        let folderPath = '';

        if (platform === 'win32') {
            // Write a PowerShell script to a temp file to avoid quoting issues
            const scriptContent = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select folder to save received files"
$dialog.ShowNewFolderButton = $true
$null = $dialog.ShowDialog()
if ($dialog.SelectedPath) {
    Write-Output $dialog.SelectedPath
}
`;
            const tempScript = path.join(os.tmpdir(), 'cetp_browse_folder.ps1');
            fs.writeFileSync(tempScript, scriptContent, 'utf-8');

            const result = execSync(
                `powershell -NoProfile -STA -ExecutionPolicy Bypass -File "${tempScript}"`,
                { encoding: 'utf-8', timeout: 120000, windowsHide: false }
            ).trim();

            // Cleanup
            try { fs.unlinkSync(tempScript); } catch { }

            folderPath = result;
        } else if (platform === 'darwin') {
            const result = execSync(
                `osascript -e 'POSIX path of (choose folder with prompt "Select folder to save received files")'`,
                { encoding: 'utf-8', timeout: 60000 }
            ).trim();
            folderPath = result;
        } else {
            const result = execSync(
                `zenity --file-selection --directory --title="Select folder to save received files"`,
                { encoding: 'utf-8', timeout: 60000 }
            ).trim();
            folderPath = result;
        }

        if (folderPath) {
            return NextResponse.json({ path: folderPath });
        } else {
            return NextResponse.json({ path: '', cancelled: true });
        }
    } catch (error: any) {
        return NextResponse.json({ path: '', cancelled: true });
    }
}
