import React, { useState, useEffect, useRef } from 'react';
import type { ViewDirection } from '@vulkan-game-tools/asset-types';
import { VIEW_DIRECTIONS } from '@vulkan-game-tools/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';

type Stage = 'concept' | 'chibi';

function getStageStatus(
  manifest: { concept: { reference_images: string[] }; chibi?: { reference_image: string } },
  stage: Stage,
): 'ready' | 'empty' {
  if (stage === 'concept') return manifest.concept.reference_images.length > 0 ? 'ready' : 'empty';
  return manifest.chibi?.reference_image ? 'ready' : 'empty';
}

const STATUS_COLORS: Record<string, { border: string; text: string; bg: string }> = {
  ready: { border: '#44aa44', text: '#70d870', bg: '#1e3a2e' },
  empty: { border: '#aa8822', text: '#ddaa44', bg: '#2a2a1a' },
};

const VIEW_LABELS: Record<ViewDirection, string> = {
  front: 'F',
  right: 'R',
  back: 'B',
  left: 'L',
};

export function ConceptPreview() {
  const manifest = useSeuratStore((s) => s.manifest);
  const conceptImageUrl = useSeuratStore((s) => s.conceptImageUrl);
  const chibiImageUrl = useSeuratStore((s) => s.chibiImageUrl);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);
  const [selectedStage, setSelectedStage] = useState<Stage>('concept');
  const [selectedView, setSelectedView] = useState<ViewDirection | null>(null);
  const [imgError, setImgError] = useState<Record<string, boolean>>({});

  // Reset error state when image URLs change
  const prevUrls = useRef({ conceptImageUrl, chibiImageUrl });
  useEffect(() => {
    const prev = prevUrls.current;
    if (conceptImageUrl !== prev.conceptImageUrl || chibiImageUrl !== prev.chibiImageUrl) {
      setImgError({});
    }
    prevUrls.current = { conceptImageUrl, chibiImageUrl };
  }, [conceptImageUrl, chibiImageUrl]);

  if (!manifest) {
    return (
      <div style={styles.empty}>Select a character to view concept art.</div>
    );
  }

  const stages: { key: Stage; label: string; url: string | null }[] = [
    { key: 'concept', label: 'Concept Art', url: conceptImageUrl },
    { key: 'chibi', label: 'Chibi/Deformed', url: chibiImageUrl },
  ];

  // Determine which URL to show in the large preview
  const viewUrls = selectedStage === 'concept' ? conceptViewUrls : chibiViewUrls;
  const hasViews = VIEW_DIRECTIONS.some((v) => viewUrls[v] !== null);
  const defaultUrl = stages.find((s) => s.key === selectedStage)?.url ?? null;
  const currentUrl = selectedView && viewUrls[selectedView]
    ? viewUrls[selectedView]
    : defaultUrl;

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
                onClick={() => { setSelectedStage(stage.key); setSelectedView(null); }}
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
                    <div style={styles.stagePlaceholder}>—</div>
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

      {/* 4-view strip (if views exist) */}
      {hasViews && (
        <div style={styles.viewStrip}>
          {VIEW_DIRECTIONS.map((view) => {
            const url = viewUrls[view];
            const isActive = selectedView === view;
            const hasImage = !!url;
            return (
              <button
                key={view}
                onClick={() => setSelectedView(isActive ? null : view)}
                style={{
                  ...styles.viewCard,
                  borderColor: isActive ? '#8a8af8' : hasImage ? '#44aa44' : '#444',
                  background: isActive ? '#1e1e3e' : '#0e0e1a',
                }}
              >
                <div style={styles.viewThumbnailBox}>
                  {url && !imgError[`${selectedStage}_${view}`] ? (
                    <img
                      src={url}
                      alt={`${view} view`}
                      style={styles.viewThumbnail}
                      onError={() => setImgError((prev) => ({ ...prev, [`${selectedStage}_${view}`]: true }))}
                    />
                  ) : (
                    <div style={styles.viewPlaceholder}>—</div>
                  )}
                </div>
                <div style={{
                  fontFamily: 'monospace',
                  fontSize: 8,
                  color: hasImage ? '#70d870' : '#666',
                  textAlign: 'center',
                }}>
                  {VIEW_LABELS[view]}
                  {hasImage && ' ✓'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Large preview of selected stage/view */}
      <div style={styles.imageBox}>
        {currentUrl && !imgError[selectedView ? `preview_${selectedView}` : `preview_${selectedStage}`] ? (
          <img
            src={currentUrl}
            alt={selectedView ?? stages.find((s) => s.key === selectedStage)?.label}
            style={styles.img}
            onError={() => setImgError((prev) => ({
              ...prev,
              [selectedView ? `preview_${selectedView}` : `preview_${selectedStage}`]: true,
            }))}
          />
        ) : (
          <div style={styles.placeholder}>
            {`No ${selectedView ?? selectedStage} art yet`}
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
    marginBottom: 12,
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
  viewStrip: {
    display: 'flex',
    gap: 6,
    marginBottom: 12,
    justifyContent: 'center',
  },
  viewCard: {
    border: '1px solid #444',
    borderRadius: 4,
    padding: 4,
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 2,
    background: 'none',
  },
  viewThumbnailBox: {
    width: 56,
    height: 56,
    background: '#0e0e1a',
    border: '1px solid #2a2a3a',
    borderRadius: 3,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewThumbnail: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    imageRendering: 'pixelated' as const,
  },
  viewPlaceholder: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#333',
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
