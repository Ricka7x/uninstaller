import {
  ActionPanel,
  Alert,
  confirmAlert,
  List,
  Action,
  Icon,
  showToast,
  Toast,
  getApplications,
  Application,
  getPreferenceValues,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { execSync } from "child_process";
import path from "path";

interface Preferences {
  debugMode: boolean;
  skipPaths?: string;
}

function log(message: string, ...args: unknown[]) {
  const { debugMode } = getPreferenceValues<Preferences>();
  if (debugMode) {
    console.log(`[Debug] ${message}`, ...args);
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function escapeShellPath(filePath: string): string {
  return `'${filePath.replace(/'/g, "'\\''")}'`;
}

function escapeAppleScript(str: string): string {
  return str.replace(/[\\"]/g, '\\$&');
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function fileExists(filePath: string): boolean {
  try {
    execSync(`test -e ${escapeShellPath(filePath)}`);
    return true;
  } catch {
    return false;
  }
}

async function removeWithAdmin(files: string[]): Promise<void> {
  const tempScript = `/tmp/uninstall_${Date.now()}.sh`;
  const scriptContent = [
    '#!/bin/bash',
    'set -e',
    '',
    'error_count=0',
    '',
    'remove_file() {',
    '  if [ -e "$1" ]; then',
    '    rm -rf "$1" || ((error_count++))',
    '  fi',
    '}',
    '',
    '# Remove files',
    ...files.map(file => `remove_file ${escapeShellPath(file)}`),
    '',
    'if [ $error_count -gt 0 ]; then',
    '  echo "Failed to remove $error_count files"',
    '  exit 1',
    'fi',
    '',
    'exit 0'
  ].join('\n');

  try {
    execSync(`echo ${escapeShellPath(scriptContent)} > ${tempScript}`);
    execSync(`chmod +x ${tempScript}`);

    const command = `do shell script "${escapeAppleScript(tempScript)}" with administrator privileges`;
    execSync(`osascript -e '${command}'`);

    execSync(`rm ${tempScript}`);
  } catch (error) {
    log("Admin removal failed:", error);
    throw new Error("Failed to remove files with administrator privileges. Please try again.");
  }
}

export default function Command() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<'appList' | 'fileList'>('appList');
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [relatedFiles, setRelatedFiles] = useState<string[]>([]);

  useEffect(() => {
    if (currentView === 'appList') {
      loadApplications();
    }
  }, [currentView]);

  async function loadApplications() {
    try {
      const apps = await getApplications();
      setApplications(apps.filter(app => app.path.startsWith("/Applications/")));
    } catch (error) {
      log("Failed to load applications:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load applications",
        message: "Could not retrieve list of installed applications. Please try again.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function findRelatedFiles(app: Application): Promise<string[]> {
    const homeDir = process.env.HOME;
    if (!homeDir) throw new Error("HOME environment variable not set");

    const { skipPaths } = getPreferenceValues<Preferences>();
    const skipList = skipPaths?.split(",").map(p => p.trim()).filter(Boolean) ?? [];

    let bundleId = "";
    try {
      bundleId = execSync(`mdls -name kMDItemCFBundleIdentifier -raw ${escapeShellPath(app.path)}`).toString().trim();
      log("Found bundle ID:", bundleId);
    } catch (error) {
      log("Failed to get bundle ID:", error);
    }

    const appName = app.name;
    const appNameLower = appName.toLowerCase();
    const appNameNoSpaces = appNameLower.replace(/\s+/g, "");
    const appNameNoSpecialChars = appNameNoSpaces.replace(/[^a-zA-Z0-9]/g, "");
    
    const commonPaths = [
      `${homeDir}/Library/Application Support/${app.name}`,
      `${homeDir}/Library/Preferences/${app.name}.plist`,
      `${homeDir}/Library/Caches/${app.name}`,
      `${homeDir}/Library/Saved Application State/${app.name}.savedState`,
      `${homeDir}/Library/Preferences/com.${appNameNoSpaces}.plist`,
      `${homeDir}/Library/Preferences/com.${appNameNoSpecialChars}.plist`,
      `${homeDir}/Library/Containers/${app.name}`,
      `${homeDir}/Library/WebKit/${app.name}`,
      `${homeDir}/Library/Logs/${app.name}`,
      `${homeDir}/Library/HTTPStorages/${app.name}`,
      `${homeDir}/Library/Cookies/${app.name}.binarycookies`,
      `${homeDir}/Library/LaunchAgents/${app.name}.plist`,
      `${homeDir}/Library/Application Scripts/${bundleId}`,
      `${homeDir}/Library/Group Containers/${bundleId}`,
      `${homeDir}/Library/Mail/Bundles/${app.name}`,
      `${homeDir}/Library/Preferences/ByHost/${app.name}.*.plist`,
      `/Library/Application Support/${app.name}`,
      `/Library/Preferences/${app.name}.plist`,
      `/Library/Caches/${app.name}`,
      `/Library/LaunchDaemons/${app.name}.plist`,
      `/Library/PrivilegedHelperTools/${app.name}`,
      `/Library/Extensions/${app.name}.kext`,
      `/Library/Input Methods/${app.name}.app`,
      `/Library/PreferencePanes/${app.name}.prefPane`,
      `/Library/QuickLook/${app.name}.qlgenerator`,
      `/Library/Screen Savers/${app.name}.saver`,
      `/Library/Services/${app.name}.service`,
      `/Library/Spotlight/${app.name}.mdimporter`,
      `/Library/StartupItems/${app.name}`,
      `${homeDir}/.${appNameNoSpaces}`,
      `${homeDir}/.${appNameNoSpecialChars}`,
      `/var/db/receipts/${app.name}.plist`,
      `/var/db/receipts/${app.name}.bom`,
      `/var/root/Library/Preferences/${app.name}.plist`,
      `/var/root/Library/Caches/${app.name}`,
      `/private/var/db/receipts/${app.name}.plist`,
      `/private/var/db/receipts/${app.name}.bom`
    ];

    if (bundleId) {
      const bundlePaths = [
        `${homeDir}/Library/Application Support/${bundleId}`,
        `${homeDir}/Library/Preferences/${bundleId}.plist`,
        `${homeDir}/Library/Caches/${bundleId}`,
        `${homeDir}/Library/Saved Application State/${bundleId}.savedState`,
        `${homeDir}/Library/Containers/${bundleId}`,
        `${homeDir}/Library/WebKit/${bundleId}`,
        `${homeDir}/Library/Logs/${bundleId}`,
        `${homeDir}/Library/HTTPStorages/${bundleId}`,
        `${homeDir}/Library/Cookies/${bundleId}.binarycookies`,
        `${homeDir}/Library/LaunchAgents/${bundleId}.plist`,
        `${homeDir}/Library/Application Scripts/${bundleId}`,
        `${homeDir}/Library/Group Containers/${bundleId}`,
        `${homeDir}/Library/Application Scripts/${bundleId}.ThumbnailShareExtension`,
        `${homeDir}/Library/Application Scripts/${bundleId}.QuickLookShareExtension`,
        `${homeDir}/Library/Containers/${bundleId}.ThumbnailShareExtension`,
        `${homeDir}/Library/Containers/${bundleId}.QuickLookShareExtension`,
        `/Library/Application Support/${bundleId}`,
        `/Library/Preferences/${bundleId}.plist`,
        `/Library/Caches/${bundleId}`,
        `/Library/LaunchDaemons/${bundleId}.plist`,
        `/Library/PrivilegedHelperTools/${bundleId}`,
        `/Library/Extensions/${bundleId}.kext`,
        `/Library/Input Methods/${bundleId}.app`,
        `/Library/PreferencePanes/${bundleId}.prefPane`,
        `/Library/QuickLook/${bundleId}.qlgenerator`,
        `/Library/Screen Savers/${bundleId}.saver`,
        `/Library/Services/${bundleId}.service`,
        `/Library/Spotlight/${bundleId}.mdimporter`,
        `/Library/StartupItems/${bundleId}`,
        `/var/db/receipts/${bundleId}.plist`,
        `/var/db/receipts/${bundleId}.bom`,
        `/var/root/Library/Preferences/${bundleId}.plist`,
        `/var/root/Library/Caches/${bundleId}`,
        `/private/var/db/receipts/${bundleId}.plist`,
        `/private/var/db/receipts/${bundleId}.bom`
      ];
      commonPaths.push(...bundlePaths);
    }

    const files = new Set<string>();
    for (const location of commonPaths) {
      if (skipList.some(skip => location.startsWith(skip))) {
        log("Skipping path:", location);
        continue;
      }

      if (fileExists(location)) {
        log("Found file:", location);
        files.add(location);
      }
    }

    try {
      const infoPlistPath = path.join(app.path, 'Contents/Info.plist');
      if (fileExists(infoPlistPath)) {
        const plistContent = execSync(`plutil -convert json -o - ${escapeShellPath(infoPlistPath)}`).toString();
        const plistData = JSON.parse(plistContent);
        
        const additionalPaths = [
          plistData.CFBundleExecutable,
          plistData.CFBundleIdentifier,
          plistData.CFBundleName,
          plistData.CFBundleDisplayName
        ].filter(Boolean).map((id) => [
          `${homeDir}/Library/Application Support/${id}`,
          `${homeDir}/Library/Preferences/${id}.plist`,
          `${homeDir}/Library/Caches/${id}`,
          `${homeDir}/Library/Saved Application State/${id}.savedState`
        ]).flat();

        for (const path of additionalPaths) {
          if (fileExists(path)) {
            files.add(path);
          }
        }
      }
    } catch (error) {
      log("Failed to parse Info.plist:", error);
    }

    return Array.from(files);
  }

  async function uninstallApplication(app: Application, files: string[]) {
    await showToast({
      style: Toast.Style.Animated,
      title: `Uninstalling ${app.name}`,
      message: `Removing ${files.length} files...`
    });

    try {
      for (const file of files) {
        execSync(`rm -rf ${escapeShellPath(file)}`);
      }
    } catch (error) {
      log("Regular removal failed, trying admin:", error);
      await removeWithAdmin(files);
    }

    if (fileExists(app.path)) {
      throw new Error("Application was not removed successfully");
    }

    await showToast({
      style: Toast.Style.Success,
      title: `Successfully uninstalled ${app.name}`,
      message: `Removed ${files.length} files`
    });

    await loadApplications();
  }

  if (currentView === 'fileList' && selectedApp) {
    const allFiles = [selectedApp.path, ...relatedFiles];
    const totalSizeKB = execSync(
      `du -sk ${allFiles.map(escapeShellPath).join(' ')} | awk '{sum+=$1} END {print sum}'`
    ).toString().trim();
    const totalSize = (parseInt(totalSizeKB) * 1024).toString();

    return (
      <List navigationTitle={`Uninstall ${selectedApp.name}`}>
        <List.Section
          title={`${allFiles.length} Files`}
          subtitle={formatBytes(parseInt(totalSize))}
        >
          {allFiles.map((file) => {
            const size = execSync(`du -sh ${escapeShellPath(file)} | cut -f1`).toString().trim();
            const fileName = path.basename(file);
            const filePath = path.dirname(file).replace(process.env.HOME || '', '~');
            const isApp = file.endsWith('.app');
            const isDirectory = file.endsWith('/') || !file.includes('.');

            return (
              <List.Item
                key={file}
                title={fileName}
                subtitle={filePath}
                icon={isApp ? { fileIcon: file } : (isDirectory ? Icon.Folder : Icon.Document)}
                accessories={[
                  {
                    text: size,
                    tooltip: `Size: ${size}`
                  },
                  {
                    icon: isDirectory ? Icon.Folder : Icon.Document
                  }
                ]}
                actions={
                  <ActionPanel>
                    <Action
                      title="Uninstall All"
                      icon={Icon.Trash}
                      style={Action.Style.Destructive}
                      onAction={async () => {
                        const options: Alert.Options = {
                          title: `Permanent Deletion Confirmation`,
                          message: `You are about to permanently delete ${allFiles.length} files and folders (${formatBytes(parseInt(totalSize))}). This includes:
                          
• The application itself
• All related support files
• Preferences and settings
• Cached data

This action cannot be undone. Are you sure you want to continue?`,
                          primaryAction: {
                            title: "Delete Permanently",
                            style: Alert.ActionStyle.Destructive,
                          },
                        };

                        if (await confirmAlert(options)) {
                          try {
                            await uninstallApplication(selectedApp, allFiles);
                            setCurrentView('appList');
                            setSelectedApp(null);
                            setRelatedFiles([]);
                          } catch (error) {
                            log("Uninstall failed:", error);
                            await showToast({
                              style: Toast.Style.Failure,
                              title: `Failed to uninstall ${selectedApp.name}`,
                              message: formatError(error),
                            });
                          }
                        }
                      }}
                    />
                    <Action
                      title="Back to App List"
                      icon={Icon.ArrowLeft}
                      onAction={() => {
                        setCurrentView('appList');
                        setSelectedApp(null);
                        setRelatedFiles([]);
                      }}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      </List>
    );
  }

  return (
    <List isLoading={isLoading}>
      {applications.map((app) => (
        <List.Item
          key={app.path}
          icon={{ fileIcon: app.path }}
          title={app.name}
          actions={
            <ActionPanel>
              <Action
                title="Uninstall"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={async () => {
                  const files = await findRelatedFiles(app);
                  setSelectedApp(app);
                  setRelatedFiles(files);
                  setCurrentView('fileList');
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
