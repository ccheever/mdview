#!/bin/bash
set -euo pipefail

# Add document type associations and UTI declarations to the mdview app bundle's Info.plist.
# This enables drag-and-drop onto the app/dock icon and Finder file associations.

MDVIEW_DIR="$(cd "$(dirname "$0")/.." && pwd)"

for APP_DIR in "$MDVIEW_DIR"/build/*/mdview*.app; do
    PLIST="$APP_DIR/Contents/Info.plist"
    if [ ! -f "$PLIST" ]; then
        continue
    fi

    # Remove existing entries so we can re-apply cleanly
    /usr/libexec/PlistBuddy -c "Delete :CFBundleDocumentTypes" "$PLIST" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Delete :UTImportedTypeDeclarations" "$PLIST" 2>/dev/null || true

    # Declare the markdown UTI so macOS knows what net.daringfireball.markdown is
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0 dict" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeIdentifier string 'net.daringfireball.markdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeDescription string 'Markdown Document'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeConformsTo array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeConformsTo:0 string 'public.plain-text'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification dict" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:0 string 'md'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:1 string 'markdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:2 string 'mdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:3 string 'mkd'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:4 string 'mkdn'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.filename-extension:5 string 'mdx'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :UTImportedTypeDeclarations:0:UTTypeTagSpecification:public.mime-type string 'text/markdown'" "$PLIST"

    # Add document types for markdown files
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0 dict" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'Markdown Document'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string 'Viewer'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string 'Alternate'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string 'net.daringfireball.markdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string 'md'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string 'markdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:2 string 'mdown'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:3 string 'mkd'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:4 string 'mkdn'" "$PLIST"
    /usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:5 string 'mdx'" "$PLIST"

    echo "Patched: $PLIST"
done
