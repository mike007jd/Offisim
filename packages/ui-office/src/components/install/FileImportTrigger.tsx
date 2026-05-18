import { Button, Input } from '@offisim/ui-core';
/**
 * FileImportTrigger — hidden file input + visible trigger button.
 * Supports .offisimpkg and .zip files with 50MB size limit.
 * Optional drag-and-drop zone can be shown via showDropZone prop.
 */

import { Package } from 'lucide-react';
import { type DragEvent, useCallback, useRef, useState } from 'react';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_EXTENSIONS = '.offisimpkg,.zip';

interface FileImportTriggerProps {
  onFileSelect: (file: File) => void;
  /** Show an inline drag-and-drop zone */
  showDropZone?: boolean;
  /** Render an icon-only trigger for constrained chrome such as the app header. */
  compact?: boolean;
}

export function FileImportTrigger({
  onFileSelect,
  showDropZone = false,
  compact = false,
}: FileImportTriggerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_SIZE) {
        // Let the hook handle size validation with proper error display
        onFileSelect(file);
        return;
      }
      onFileSelect(file);
    },
    [onFileSelect],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
      // Reset so the same file can be selected again
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <>
      {/* Hidden file input */}
      <Input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleInputChange}
        aria-label="Select package file"
      />

      {/* Trigger button */}
      <Button
        variant="outline"
        size="sm"
        onClick={openFilePicker}
        className={compact ? 'h-8 w-8 px-0' : 'h-8'}
        title="Install package from file"
        aria-label="Install package from file"
      >
        <Package className="h-4 w-4" />
        {!compact && 'Install Package'}
      </Button>

      {/* Optional drop zone */}
      {showDropZone && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-2 border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? 'border-lobster-red bg-lobster-red/5 text-sand'
              : 'border-ocean-light text-ocean-light hover:border-shell'
          }`}
        >
          <Package className="mx-auto h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Drop .offisimpkg or .zip file here</p>
          <p className="text-xs mt-1">Max 50MB</p>
        </div>
      )}
    </>
  );
}
