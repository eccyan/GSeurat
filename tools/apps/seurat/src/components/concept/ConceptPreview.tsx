import React, { useState, useEffect, useRef } from 'react';
import { useSeuratStore } from '../../store/useSeuratStore.js';

type Stage = 'concept' | 'chibi' | 'pixel';

function getStageStatus(
  manifest: { concept: { approved: boolean }; chibi?: { approved: boolean; reference_image: string }; pixel?: { approved: boolean; reference_image: string } },
  stage: Stage,
): 'approved' | 'pending' | 'locked' {
  if (stage === 'concept') return manifest.concept.approved ? 'approved' : 'pending';
  if (stage === 'chibi') {
    if (!manifest.concept.approved) return 'locked';
    if (manifest.chibi?.approved) return 'approved';
    return manifest.chibi?.reference_image ? 'pending' : 'locked';
  }
  // pixel
  if (!manifest.chibi?.approved) return 'locked';
  if (manifest.pixel?.approved) return 'approved';
  return manifest.pixel?.reference_image ? 'pending' : 'locked';
}

const STATUS_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  approved: { border: '#44aa44', text: '#70d870', bg: '#1e3a2e' },
  pending: { border: '#aa8822', text: '#ddaa44', bg: '#2a2a1a' },
  locked: { border: '#444', text: '#666', bg: '#1a1a1a' },
};

export function ConceptPreview() {
  const manifest = useSeuratStore((s) => s.manifest);
  const conceptImageUrl = useSeuratStore((s) => s.conceptImageUrl);
  const chibiImageUrl = useSeuratStore((s) => s.chibiImageUrl);
  const pixelImageUrl = useSeuratStore((s) => s.pixelImageUrl);
  const [selectedStage, setSelectedStage] = useState<Stage>('concept');
  const [imgError, setImgError] = useState<Record<Stage, boolean>>({ concept: false, chibi: false, pixel: false });

  // Reset error state when image URLs change (e.g. after generation)
  const prevUrls = useRef({ conceptImageUrl, chibiImageUrl, pixelImageUrl });
  useEffect(() => {
    const prev = prevUrls.current;
    const reset: Partial<Record<Stage, boolean>> = {};
    if (conceptImageUrl !== prev.conceptImageUrl) reset.concept = false;
    if (chibiImageUrl !== prev.chibiImageUrl) reset.chibi = false;
    if (pixelImageUrl !== prev.pixelImageUrl) reset.pixel = false;
    if (Object.keys(reset).length > 0) {
      setImgError((e) => ({ ...e, ...reset }));
    }
    prevUrls.current = { conceptImageUrl, chibiImageUrl, pixelImageUrl };
  }, [conceptImageUrl, chibiImageUrl, pixelImageUrl]);

  if (!manifest) {
    return (
      <div style={styles.empty}>Select a character to view concept art.</div>
    );
  }

  const stages: { key: Stage; label: string; url: string | null }[] = [
    { key: 'concept', label: 'Concept Art', url: conceptImageUrl },
    { key: 'chibi', label: 'Chibi/Deformed', url: chibiImageUrl },
    { key: 'pixel', label: 'Pixel Art', url: pixelImageUrl },
  ];

  const currentUrl = stages.find((s) => s.key === selectedStage)?.url ?? null;

  return (
    <div style={styles.container}>
      {/* Pipeline stepper */}
      <div style={styles.stepper}>
        {stages.map((stage, i) => {
          const status = getStageStatus(manifest, stage.key);
          const colors = STATUS_COLORS[status];
          const isSelected = selectedStage === stage.key;
          return (
            <React.Fragment key={stage.key}>
              {i > 0 && <div style={styles.arrow}>→</div>}
              <button
                onClick={() => setSelectedStage(stage.key)}
                style={{
                  ...styles.stageCard,
                  borderColor: isSelected ? '#8a8af8' : colors.border,
                  background: isSelected ? '#1e1e3e' : colors.bg,
                }}
              >
                <div style={styles.stageThumbnailBox}>
                  {stage.url && !imgError[stage.key] ? (
                    <img
                      src={stage.url}
                      alt={stage.label}
                      style={styles.stageThumbnail}
                      onError={() => setImgError((prev) => ({ ...prev, [stage.key]: true }))}
                    />
                  ) : (
                    <div style={styles.stagePlaceholder}>
                      {status === 'locked' ? '🔒' : '—'}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#ccc', textAlign: 'center' }}>{stage.label}</div>
                <div style={{ fontFamily: 'monospace', fontSize: 8, color: colors.text, textAlign: 'center' }}>
                  {status}
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Large preview of selected stage */}
      <div style={styles.imageBox}>
        {currentUrl && !imgError[selectedStage] ? (
          <img
            src={currentUrl}
            alt={stages.find((s) => s.key === selectedStage)?.label}
            style={styles.img}
            onError={() => setImgError((prev) => ({ ...prev, [selectedStage]: true }))}
          />
        ) : (
          <div style={styles.placeholder}>
            {getStageStatus(manifest, selectedStage) === 'locked'
              ? 'Complete previous stage first'
              : `No ${selectedStage} art yet`}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    overflowY: 'auto',
  },
  empty: {
    padding: 24,
    textAlign: 'center',
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  stepper: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  stageCard: {
    border: '1px solid #444',
    borderRadius: 6,
    padding: 8,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 4,
    minWidth: 100,
    background: 'none',
  },
  stageThumbnailBox: {
    width: 80,
    height: 80,
    background: '#0e0e1a',
    border: '1px solid #2a2a3a',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  stagePlaceholder: {
    fontFamily: 'monospace',
    fontSize: 16,
    color: '#444',
  },
  arrow: {
    fontFamily: 'monospace',
    fontSize: 18,
    color: '#555',
  },
  imageBox: {
    width: '100%',
    maxWidth: 480,
    aspectRatio: '1',
    background: '#0e0e1a',
    border: '1px solid #2a2a3a',
    borderRadius: 6,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  placeholder: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#444',
    textAlign: 'center',
    padding: 16,
  },
};
