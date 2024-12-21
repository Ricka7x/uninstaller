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
      // Show searching toast
      await showToast({
        style: Toast.Style.Animated,
        title: "Finding related files...",
      });

      // Find related files
      const appSize = await getFileSize(app.path);
      const escapedName = app.name.replace(/["()]/g, '\\$&');
      const mdfindCmd = `mdfind "kMDItemDisplayName == '${escapedName}'*c || kMDItemPath == *'${escapedName}.app'*c"`;
      const relatedFiles = execSync(mdfindCmd, { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .filter(file => 
          file.includes("/Library/") || 
          file.includes(app.path)
        );

      // Get sizes for all files
      const relatedFilesWithSizes = await Promise.all(
        relatedFiles.map(async (file) => ({
          path: file,
          size: await getFileSize(file)
        }))
      );

      // Build detailed message
      let message = `The following items will be removed:\n\n`;
      message += `📦 ${app.name}.app (${appSize})\n   ${app.path}\n\n`;
      
      if (relatedFilesWithSizes.length > 0) {
        message += `Related files:\n`;
        relatedFilesWithSizes.forEach(({path: filePath, size}) => {
          message += `📄 ${path.basename(filePath)} (${size})\n   ${filePath}\n`;
        });
      }

      const { alwaysUseAdmin } = getPreferenceValues<{ alwaysUseAdmin: boolean }>();
      if (alwaysUseAdmin || app.path.startsWith("/Applications/")) {
        message += `\nThis may require administrator privileges and you'll be prompted for your password if needed.`;
      }

      const options: Alert.Options = {
        title: "Uninstall Application",
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
