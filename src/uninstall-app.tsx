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

export default function Command() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadApplications();
  }, []);

  async function loadApplications() {
    try {
      const apps = await getApplications();
      setApplications(apps.filter(app => app.path.startsWith("/Applications/")));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load applications",
        message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function getFileSize(path: string): Promise<string> {
    try {
      return execSync(`du -sh "${path}" | cut -f1`).toString().trim();
    } catch (error: unknown) {
      console.error("Failed to get file size:", error);
      return "unknown size";
    }
  }

  async function uninstallApplication(app: Application) {
    async function removeWithAdmin(files: string[]) {
      const tempScript = `/tmp/uninstall_${Date.now()}.sh`;
      const scriptContent = [
        '#!/bin/bash',
        'set -e',
        'error_count=0',
        '',
        'remove_file() {',
        '  if [ -e "$1" ]; then',
        '    rm -rf "$1" || ((error_count++))',
        '  fi',
        '}',
        '',
        '# Remove files',
        ...files.map(file => `remove_file "${file}"`),
        '',
        'if [ $error_count -gt 0 ]; then',
        '  echo "Failed to remove $error_count files"',
        '  exit 1',
        'fi',
        '',
        'exit 0'
      ].join('\n');

      execSync(`echo '${scriptContent.replace(/'/g, "'\\''")}'> ${tempScript}`);
      execSync(`chmod +x ${tempScript}`);
      execSync(`osascript -e 'do shell script "${tempScript}" with administrator privileges'`);
      execSync(`rm ${tempScript}`);
    }

    try {
      // Find related files
      const appSize = await getFileSize(app.path);
      
      // Get app bundle identifier
      let bundleId = "";
      try {
        bundleId = execSync(`mdls -name kMDItemCFBundleIdentifier -raw "${app.path}"`).toString().trim();
        console.log("Found bundle ID:", bundleId);
      } catch (error) {
        console.error("Failed to get bundle ID:", error);
      }

      // Find related files in common locations
      const homeDir = process.env.HOME;
      const relatedFiles: string[] = [];

      // Get app name variations
      const appNameLower = app.name.toLowerCase();
      const appNameNoSpaces = appNameLower.replace(/\s+/g, '');
      
      // Common paths to check
      const commonPaths = [
        // User Library
        `${homeDir}/Library/Application Support/${app.name}`,
        `${homeDir}/Library/Preferences/${app.name}.plist`,
        `${homeDir}/Library/Caches/${app.name}`,
        `${homeDir}/Library/Saved Application State/${app.name}.savedState`,
        `${homeDir}/Library/Preferences/com.${appNameNoSpaces}.plist`,
        `${homeDir}/Library/Containers/${app.name}`,
        `${homeDir}/Library/WebKit/${app.name}`,
        
        // System Library
        `/Library/Application Support/${app.name}`,
        `/Library/Preferences/${app.name}.plist`,
        `/Library/Caches/${app.name}`
      ];

      // Add bundle ID paths if available
      if (bundleId) {
        const bundlePaths = [
          `${homeDir}/Library/Application Support/${bundleId}`,
          `${homeDir}/Library/Preferences/${bundleId}.plist`,
          `${homeDir}/Library/Caches/${bundleId}`,
          `${homeDir}/Library/Saved Application State/${bundleId}.savedState`,
          `${homeDir}/Library/Containers/${bundleId}`,
          `/Library/Application Support/${bundleId}`,
          `/Library/Preferences/${bundleId}.plist`
        ];
        commonPaths.push(...bundlePaths);
      }

      // Check each path
      for (const location of commonPaths) {
        try {
          const exists = execSync(`test -e "${location}" && echo "exists"`).toString().includes("exists");
          if (exists) {
            console.log("Found file:", location);
            relatedFiles.push(location);
          }
        } catch {
          // Path doesn't exist, skip it
        }
      }

      // Get sizes for existing files
      const relatedFilesWithSizes = await Promise.all(
        relatedFiles.map(async (file) => {
          const size = await getFileSize(file);
          return { path: file, size };
        })
      );

      console.log("Found files:", relatedFilesWithSizes);

      // Calculate sizes
      const appSizeNum = parseInt(appSize);
      const totalSizeNum = parseInt(execSync(`du -sh "${app.path}" ${relatedFiles.join(" ")} | awk '{sum += $1} END {print sum}'`).toString().trim());
      const relatedSizeNum = totalSizeNum - appSizeNum;

      // Format sizes
      const formatSize = (size: number) => {
        if (size >= 1000) {
          return `${(size / 1000).toFixed(1)}G`;
        }
        return `${size}M`;
      };
      
      // Build message
      let message = `${app.name}.app and ${relatedFilesWithSizes.length} related files (${formatSize(totalSizeNum)} total)`;
      
      // Add main app
      message += `\n\n📦 ${app.name}.app (${formatSize(appSizeNum)})`;
      
      // Add related files if any
      if (relatedFilesWithSizes.length > 0) {
        message += `\n📄 ${relatedFilesWithSizes.length} related files (${formatSize(relatedSizeNum)})`;
      }

      const options: Alert.Options = {
        title: `Uninstall ${app.name}`,
        message,
        primaryAction: {
          title: "Uninstall",
          style: Alert.ActionStyle.Destructive,
        },
      };

      if (await confirmAlert(options)) {
        await showToast({
          style: Toast.Style.Animated,
          title: `Uninstalling ${app.name}`,
          message: `Removing ${relatedFiles.length + 1} files...`
        });

        try {
          const allFiles = [app.path, ...relatedFiles];
          const { alwaysUseAdmin } = getPreferenceValues<{ alwaysUseAdmin: boolean }>();
          
          // Try without admin privileges first if not forced
          if (!alwaysUseAdmin) {
            try {
              for (const file of allFiles) {
                execSync(`rm -rf "${file}"`);
              }
            } catch {
              // If regular removal fails, try with admin privileges
              await removeWithAdmin(allFiles);
            }
          } else {
            // Always use admin privileges
            await removeWithAdmin(allFiles);
          }

          // Wait a moment for the filesystem to update
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Verify the app was removed
          const appStillExists = await new Promise<boolean>(resolve => {
            try {
              execSync(`test -d "${app.path}"`);
              resolve(true);
            } catch {
              resolve(false);
            }
          });

          if (appStillExists) {
            throw new Error("Application was not removed successfully");
          }

          await showToast({
            style: Toast.Style.Success,
            title: `Successfully uninstalled ${app.name}`,
            message: `Removed ${allFiles.length} files`
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to execute uninstall script: ${message}`);
        }

        // Force refresh the applications list
        await loadApplications();
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await showToast({
        style: Toast.Style.Failure,
        title: `Failed to uninstall ${app.name}`,
        message,
      });
    }
  }

  return (
    <List isLoading={isLoading}>
      {applications.map((app) => (
        <List.Item
          key={app.path}
          icon={{ fileIcon: app.path }}
          title={app.name}
          subtitle={path.basename(app.path)}
          actions={
            <ActionPanel>
              <Action
                title="Uninstall"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => uninstallApplication(app)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
