# Uninstaller

A powerful application uninstaller for macOS that helps you completely remove applications and their associated files.

## Features

- Lists all applications from /Applications
- Shows application icons and sizes
- Finds and removes related files from:
  - Application Support
  - Caches
  - Preferences
  - Other Library folders
- Smart privilege handling:
  - Tries to remove files without admin privileges first
  - Only requests password when needed
  - Option to always use admin privileges

## Preferences

### Always Use Admin Privileges

When enabled, the extension will always request administrator privileges when uninstalling applications. If disabled (default), it will only request privileges when needed, typically for applications in /Applications.

## Usage

1. Open Raycast and select "Uninstall App"
2. Browse or search for the application you want to uninstall
3. Click the "Uninstall" action
4. Review the list of files that will be removed
5. Confirm the uninstallation
6. Enter your password if prompted

The extension will remove the application and all its related files, then show a success message with the number of files removed.
