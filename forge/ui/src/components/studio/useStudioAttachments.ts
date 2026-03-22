import { useCallback, useMemo, useState } from 'react';
import apiClient from '../../api/client';
import type { StudioAttachment } from '../../api/types';

function attachmentSignature(file: Pick<File, 'name' | 'size' | 'type'>) {
  return `${file.name}::${file.size}::${file.type || 'unknown'}`;
}

function uploadedAttachmentSignature(attachment: StudioAttachment) {
  return `${attachment.originalName}::${attachment.size}::${attachment.mimeType || 'unknown'}`;
}

export function useStudioAttachments(projectId: string) {
  const [pendingFiles, setPendingFiles] = useState<StudioAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!files.length || !projectId) return;

    const existing = new Set(pendingFiles.map(uploadedAttachmentSignature));
    const uniqueFiles = files.filter((file) => !existing.has(attachmentSignature(file)));

    if (uniqueFiles.length === 0) {
      setUploadError('Those files are already attached.');
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const result = await apiClient.uploadStudioAttachments(projectId, uniqueFiles);
      if (result.attachments && result.attachments.length > 0) {
        setPendingFiles((prev) => {
          const seen = new Set(prev.map(uploadedAttachmentSignature));
          const next = [...prev];
          for (const attachment of result.attachments) {
            const sig = uploadedAttachmentSignature(attachment);
            if (!seen.has(sig)) {
              seen.add(sig);
              next.push(attachment);
            }
          }
          return next;
        });
      } else {
        setUploadError('Upload returned no files. Check format or try again.');
      }
    } catch (err: any) {
      console.error('[ChatRail] Upload failed:', err.message);
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setDragActive(false);
    }
  }, [pendingFiles, projectId]);

  const removePendingFile = useCallback((id: string) => {
    setPendingFiles((prev) => prev.filter((attachment) => attachment.id !== id));
    setUploadError(null);
  }, []);

  const clearPendingFiles = useCallback(() => {
    setPendingFiles([]);
    setUploadError(null);
    setDragActive(false);
  }, []);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items || [])
      .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
      .filter((file): file is File => Boolean(file));
    if (files.length > 0) {
      event.preventDefault();
      void uploadFiles(files);
    }
  }, [uploadFiles]);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const currentTarget = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && currentTarget.contains(relatedTarget)) return;
    setDragActive(false);
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (files.length > 0) {
      void uploadFiles(files);
    }
  }, [uploadFiles]);

  const inputHint = useMemo(() => {
    if (dragActive) return 'Drop files to attach them...';
    if (uploading) return 'Uploading attachments...';
    return null;
  }, [dragActive, uploading]);

  return {
    pendingFiles,
    uploading,
    uploadError,
    dragActive,
    inputHint,
    uploadFiles,
    removePendingFile,
    clearPendingFiles,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setUploadError,
  };
}
