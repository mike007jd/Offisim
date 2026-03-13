import { Button } from '@aics/ui-core';
/**
 * FileImportTrigger — hidden file input + visible trigger button.
 * Supports .aicspkg and .zip files with 50MB size limit.
 * Optional drag-and-drop zone can be shown via showDropZone prop.
 */

import { Package } from 'lucide-react';
import { type DragEvent, useCallback, useRef, useState } from 'react';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ACCEPTED_EXTENSIONS = '.aicspkg,.zip,.md';

interface FileImportTriggerProps {
  onFileSelect: (file: File) => void;
  /** Show an inline drag-and-drop zone */
  showDropZone?: boolean;
}

export function FileImportTrigger({ onFileSelect, showDropZone = false }: FileImportTriggerProps) {
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
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleInputChange}
        aria-label="Select package file"
      />

      {/* Trigger button */}
      <Button variant="outline" size="sm" onClick={openFilePicker}>
        <Package className="h-4 w-4" />
        Install Package
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
          <p className="text-sm">Drop .aicspkg, .zip, or SKILL.md file here</p>
          <p className="text-xs mt-1">Max 50MB</p>
        </div>
      )}
    </>
  );
}
