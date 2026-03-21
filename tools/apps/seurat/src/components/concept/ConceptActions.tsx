import React, { useRef, useState, useEffect } from 'react';
import type { ConceptArt, ChibiArt, ViewDirection } from '@gseurat/asset-types';
import { useSeuratStore } from '../../store/useSeuratStore.js';
import { ComfySettingsPanel, type ComfySettings } from './ComfySettingsPanel.js';
import { NumericInput } from '../NumericInput.js';

type PoseOption = 'all' | ViewDirection;

const POSE_OPTIONS: { value: PoseOption; label: string }[] = [
  { value: 'all',   label: 'All' },
  { value: 'front', label: 'Front' },
  { value: 'back',  label: 'Back' },
  { value: 'right', label: 'Right' },
  { value: 'left',  label: 'Left' },
];

const UPLOAD_OPTIONS: { value: 'concept' | ViewDirection; label: string }[] = [
  { value: 'concept', label: 'Concept' },
  { value: 'front',   label: 'Front' },
  { value: 'back',    label: 'Back' },
  { value: 'right',   label: 'Right' },
  { value: 'left',    label: 'Left' },
];

type StepStatus = 'pending' | 'ready' | 'done';

function StepHeader({ step, title, status, expanded, onToggle }: {
  step: number;
  title: string;
  status: StepStatus;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusColors: Record<StepStatus, string> = {
    pending: '#666',
    ready: '#886600',
    done: '#44aa44',
  };
  const statusLabels: Record<StepStatus, string> = {
    pending: 'pending',
    ready: 'ready',
    done: 'done',
  };
  return (
    <button onClick={onToggle} style={styles.stepHeader}>
      <span style={styles.stepNumber}>{step}</span>
      <span style={styles.stepTitle}>{title}</span>
      <span style={{ ...styles.stepBadge, borderColor: statusColors[status], color: statusColors[status] }}>
        {statusLabels[status]}
      </span>
      <span style={styles.stepArrow}>{expanded ? '▾' : '▸'}</span>
    </button>
  );
}

export function ConceptActions() {
  const manifest = useSeuratStore((s) => s.manifest);
  const saveConcept = useSeuratStore((s) => s.saveConcept);
  const aiConfig = useSeuratStore((s) => s.aiConfig);
  const setAIConfig = useSeuratStore((s) => s.setAIConfig);
  const conceptGenerating = useSeuratStore((s) => s.conceptGenerating);
  const conceptError = useSeuratStore((s) => s.conceptError);
  const hasConceptBase = useSeuratStore((s) => s.hasConceptBase);
  const generateConceptArt = useSeuratStore((s) => s.generateConceptArt);
  const cancelGeneration = useSeuratStore((s) => s.cancelGeneration);
  const uploadConceptImage = useSeuratStore((s) => s.uploadConceptImage);
  const uploadConceptImageForView = useSeuratStore((s) => s.uploadConceptImageForView);
  const conceptPoseGenerating = useSeuratStore((s) => s.conceptPoseGenerating);
  const conceptPoseError = useSeuratStore((s) => s.conceptPoseError);
  const conceptPoseProgress = useSeuratStore((s) => s.conceptPoseProgress);
  const generateConceptPoses = useSeuratStore((s) => s.generateConceptPoses);
  const detectingPose = useSeuratStore((s) => s.detectingPose);
  const detectedPoseBytes = useSeuratStore((s) => s.detectedPoseBytes);
  const detectConceptPose = useSeuratStore((s) => s.detectConceptPose);
  const deriveDirectionalFromDetected = useSeuratStore((s) => s.deriveDirectionalFromDetected);
  const detectConceptViewPoses = useSeuratStore((s) => s.detectConceptViewPoses);
  const detectedViewPoseUrls = useSeuratStore((s) => s.detectedViewPoseUrls);
  const detectedViewPoseBytes = useSeuratStore((s) => s.detectedViewPoseBytes);
  const conceptViewUrls = useSeuratStore((s) => s.conceptViewUrls);
  const chibiViewUrls = useSeuratStore((s) => s.chibiViewUrls);

  // Chibi store bindings
  const saveChibi = useSeuratStore((s) => s.saveChibi);
  const chibiGenerating = useSeuratStore((s) => s.chibiGenerating);
  const chibiError = useSeuratStore((s) => s.chibiError);
  const chibiViewsGenerating = useSeuratStore((s) => s.chibiViewsGenerating);
  const chibiViewsError = useSeuratStore((s) => s.chibiViewsError);
  const chibiViewsProgress = useSeuratStore((s) => s.chibiViewsProgress);
  const generateChibiViews = useSeuratStore((s) => s.generateChibiViews);
  const generateChibiArt = useSeuratStore((s) => s.generateChibiArt);
  const uploadChibiImageForView = useSeuratStore((s) => s.uploadChibiImageForView);

  const conceptFileRef = useRef<HTMLInputElement>(null);
  const viewFileRef = useRef<HTMLInputElement>(null);
  const chibiFileRef = useRef<HTMLInputElement>(null);

  const [poseDirection, setPoseDirection] = useState<PoseOption>('all');
  const [uploadTarget, setUploadTarget] = useState<'concept' | ViewDirection>('concept');
  const [description, setDescription] = useState('');
  const [stylePrompt, setStylePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Chibi local state
  const [chibiStylePrompt, setChibiStylePrompt] = useState('chibi, super deformed, 2-3 head body ratio, cute, simple features');
  const [chibiNegativePrompt, setChibiNegativePrompt] = useState('realistic, photograph, 3d render');
  const [chibiIpWeight, setChibiIpWeight] = useState(0.6);
  const [chibiIpEndAt, setChibiIpEndAt] = useState(0.7);
  const [chibiGenDirection, setChibiGenDirection] = useState<'all' | ViewDirection>('all');
  const [chibiUploadDirection, setChibiUploadDirection] = useState<ViewDirection>('front');

  const [comfySettings, setComfySettings] = useState<ComfySettings>({
    checkpoint: '', vae: '', steps: 20, cfg: 10, sampler: 'euler', scheduler: 'normal', seed: -1, denoise: 1.0, loras: [],
  });

  const [chibiComfySettings, setChibiComfySettings] = useState<ComfySettings>({
    checkpoint: '', vae: '', steps: 20, cfg: 10, sampler: 'euler', scheduler: 'normal', seed: -1, denoise: 0.75, loras: [],
  });

  // Step expansion state — completed steps collapse, active step expands
  const [expandedSteps, setExpandedSteps] = useState<Record<number, boolean>>({ 1: true, 2: false, 3: false, 4: false, 5: false });
  const toggleStep = (step: number) => setExpandedSteps((s) => ({ ...s, [step]: !s[step] }));

  useEffect(() => {
    setComfySettings((s) => ({ ...s, sampler: aiConfig.sampler }));
    setChibiComfySettings((s) => ({ ...s, sampler: aiConfig.sampler }));
  }, [aiConfig.sampler]);

  useEffect(() => {
    if (!manifest) return;
    setDescription(manifest.concept.description);
    setStylePrompt(manifest.concept.style_prompt);
    setNegativePrompt(manifest.concept.negative_prompt);
    const gs = manifest.concept.generation_settings;
    if (gs) {
      setComfySettings({
        checkpoint: gs.checkpoint ?? '',
        vae: gs.vae ?? '',
        steps: gs.steps ?? 20,
        cfg: gs.cfg ?? 10,
        sampler: gs.sampler ?? 'euler',
        scheduler: gs.scheduler ?? 'normal',
        seed: gs.seed ?? -1,
        denoise: gs.denoise ?? 1.0,
        loras: gs.loras ?? [],
      });
    }
    // Chibi settings
    if (manifest.chibi) {
      setChibiStylePrompt(manifest.chibi.style_prompt);
      setChibiNegativePrompt(manifest.chibi.negative_prompt);
      const cgs = manifest.chibi.generation_settings;
      if (cgs) {
        setChibiComfySettings({
          checkpoint: cgs.checkpoint ?? '',
          vae: cgs.vae ?? '',
          steps: cgs.steps ?? 20,
          cfg: cgs.cfg ?? 10,
          sampler: cgs.sampler ?? 'euler',
          scheduler: cgs.scheduler ?? 'normal',
          seed: cgs.seed ?? -1,
          denoise: cgs.denoise ?? 0.75,
          loras: cgs.loras ?? [],
        });
        setChibiIpWeight(cgs.ipAdapterWeight ?? 0.6);
        setChibiIpEndAt(cgs.ipAdapterEndAt ?? 0.7);
      }
    }
  }, [manifest?.character_id]);

  if (!manifest) return null;

  // Step status computation
  const step1Done = hasConceptBase;
  const step2Done = !!detectedPoseBytes;
  const allViewPosesDerived = (['front', 'back', 'right', 'left'] as ViewDirection[]).every(
    (v) => detectedViewPoseBytes[v] !== null,
  );
  const step3Done = allViewPosesDerived;
  const allConceptViews = (['front', 'back', 'right', 'left'] as ViewDirection[]).every(
    (v) => conceptViewUrls[v] !== null,
  );
  const step4Done = allConceptViews;
  const allChibiViews = (['front', 'back', 'right', 'left'] as ViewDirection[]).every(
    (v) => chibiViewUrls[v] !== null,
  );
  const step5Done = allChibiViews;

  const step1Status: StepStatus = step1Done ? 'done' : 'ready';
  const step2Status: StepStatus = step2Done ? 'done' : step1Done ? 'ready' : 'pending';
  const step3Status: StepStatus = step3Done ? 'done' : step2Done ? 'ready' : 'pending';
  const step4Status: StepStatus = step4Done ? 'done' : step3Done ? 'ready' : 'pending';
  const step5Status: StepStatus = step5Done ? 'done' : step4Done ? 'ready' : 'pending';

  const busy = conceptGenerating || conceptPoseGenerating;
  const noPrompt = !description && !stylePrompt;
  const chibiBusy = chibiGenerating || chibiViewsGenerating;

  const comfyOverrides = {
    steps: comfySettings.steps, cfg: comfySettings.cfg, sampler: comfySettings.sampler,
    scheduler: comfySettings.scheduler || undefined, seed: comfySettings.seed,
    loras: comfySettings.loras, checkpoint: comfySettings.checkpoint || undefined,
    vae: comfySettings.vae || undefined,
  };

  const chibiComfyOverrides = {
    steps: chibiComfySettings.steps, cfg: chibiComfySettings.cfg, sampler: chibiComfySettings.sampler,
    scheduler: chibiComfySettings.scheduler || undefined, seed: chibiComfySettings.seed,
    loras: chibiComfySettings.loras, checkpoint: chibiComfySettings.checkpoint || undefined,
    vae: chibiComfySettings.vae || undefined, denoise: chibiComfySettings.denoise,
    ipAdapterWeight: chibiIpWeight, ipAdapterEndAt: chibiIpEndAt,
  };

  const handleSave = async () => {
    setSaving(true);
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    setSaving(false);
  };

  const handleGenerateConcept = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    await generateConceptArt(comfyOverrides);
  };

  const handleGeneratePoses = async () => {
    const concept: ConceptArt = {
      ...manifest.concept,
      description,
      style_prompt: stylePrompt,
      negative_prompt: negativePrompt,
    };
    await saveConcept(concept);
    const views = poseDirection === 'all' ? undefined : [poseDirection as ViewDirection];
    await generateConceptPoses(views, comfyOverrides);
  };

  const handleUpload = () => {
    if (uploadTarget === 'concept') {
      conceptFileRef.current?.click();
    } else {
      viewFileRef.current?.click();
    }
  };

  const handleConceptFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadConceptImage(file);
    e.target.value = '';
  };

  const handleViewFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadConceptImageForView(file, uploadTarget as ViewDirection);
    e.target.value = '';
  };

  const handleGenerateChibi = async () => {
    const chibi: ChibiArt = {
      ...manifest.chibi,
      style_prompt: chibiStylePrompt,
      negative_prompt: chibiNegativePrompt,
      reference_image: manifest.chibi?.reference_image || '',
    };
    await saveChibi(chibi);
    if (chibiGenDirection === 'all') {
      await generateChibiViews(chibiComfyOverrides);
    } else {
      await generateChibiArt(chibiGenDirection as ViewDirection, chibiComfyOverrides);
    }
  };

  const handleChibiUpload = () => chibiFileRef.current?.click();
  const handleChibiFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadChibiImageForView(file, chibiUploadDirection);
    e.target.value = '';
  };

  return (
    <div style={styles.container}>
      {/* ── Step 1: Identity Concept ── */}
      <StepHeader step={1} title="Identity Concept" status={step1Status} expanded={expandedSteps[1]} onToggle={() => toggleStep(1)} />
      {expandedSteps[1] && (
        <div style={styles.stepBody}>
          <label style={styles.label}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={styles.textarea} placeholder="Describe the character..." />

          <label style={styles.label}>Style Prompt</label>
          <textarea value={stylePrompt} onChange={(e) => setStylePrompt(e.target.value)} rows={2} style={styles.textarea} placeholder="pixel art, 128x128..." />

          <label style={styles.label}>Negative Prompt</label>
          <textarea value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} rows={2} style={styles.textarea} placeholder="blurry, realistic..." />

          <div style={styles.actions}>
            <button onClick={handleSave} disabled={saving} style={styles.saveBtn}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>

          <ComfySettingsPanel label="Concept" settings={comfySettings} onChange={setComfySettings} savedSettings={manifest.concept.generation_settings} />

          <div style={styles.remBgSection}>
            <label style={{ ...styles.label, marginTop: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={aiConfig.removeBackground} onChange={(e) => setAIConfig({ removeBackground: e.target.checked })} />
              Remove Background
            </label>
            {aiConfig.removeBackground && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <label style={{ ...styles.label, marginTop: 0, whiteSpace: 'nowrap' }}>Node</label>
                <input value={aiConfig.remBgNodeType} onChange={(e) => setAIConfig({ remBgNodeType: e.target.value })} style={styles.remBgInput} placeholder="BRIA_RMBG_Zho" />
              </div>
            )}
          </div>

          <div style={styles.actionRow}>
            <button onClick={handleGenerateConcept} disabled={conceptGenerating || noPrompt} style={{ ...styles.conceptBtn, opacity: conceptGenerating || noPrompt ? 0.5 : 1 }}>
              {conceptGenerating ? 'Generating...' : 'Generate Concept'}
            </button>
            <button onClick={cancelGeneration} disabled={!conceptGenerating} style={{ ...styles.cancelBtn, opacity: conceptGenerating ? 1 : 0.3 }}>Cancel</button>
          </div>

          {/* Upload */}
          <div style={styles.actionRow}>
            <select value={uploadTarget} onChange={(e) => setUploadTarget(e.target.value as 'concept' | ViewDirection)} style={styles.dirSelect}>
              {UPLOAD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={handleUpload} disabled={busy} style={{ ...styles.uploadBtn, opacity: busy ? 0.5 : 1 }}>Upload</button>
            <input ref={conceptFileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleConceptFileChange} />
            <input ref={viewFileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleViewFileChange} />
          </div>

          {conceptGenerating && conceptError?.includes('retrying') && <div style={styles.progressText}>{conceptError}</div>}
          {conceptError && !conceptError.includes('retrying') && <div style={styles.errorText}>{conceptError}</div>}
        </div>
      )}

      {/* ── Step 2: Detect Skeleton ── */}
      <StepHeader step={2} title="Detect Skeleton" status={step2Status} expanded={expandedSteps[2]} onToggle={() => toggleStep(2)} />
      {expandedSteps[2] && (
        <div style={styles.stepBody}>
          {!step1Done && <div style={styles.disabledHint}>Complete step 1 first</div>}
          <button
            onClick={detectConceptPose}
            disabled={!step1Done || detectingPose}
            style={{ ...styles.detectBtn, opacity: !step1Done || detectingPose ? 0.5 : 1, width: '100%' }}
          >
            {detectingPose ? 'Detecting...' : 'Detect Skeleton'}
          </button>
          {step2Done && <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870' }}>Skeleton detected</div>}
        </div>
      )}

      {/* ── Step 3: Derive Directional Skeletons ── */}
      <StepHeader step={3} title="Derive View Skeletons" status={step3Status} expanded={expandedSteps[3]} onToggle={() => toggleStep(3)} />
      {expandedSteps[3] && (
        <div style={styles.stepBody}>
          {!step2Done && <div style={styles.disabledHint}>Complete step 2 first</div>}
          <div style={styles.actionRow}>
            <button
              onClick={deriveDirectionalFromDetected}
              disabled={!step2Done || detectingPose || conceptPoseGenerating}
              style={{ ...styles.detectBtn, opacity: !step2Done || detectingPose ? 0.5 : 1, flex: 1 }}
              title="Extract keypoints from detected pose and create skeletons for all directions"
            >
              {detectingPose ? 'Deriving...' : 'Derive View Poses'}
            </button>
            <button
              onClick={detectConceptViewPoses}
              disabled={!step2Done || detectingPose || conceptPoseGenerating}
              style={{ ...styles.detectBtn, opacity: detectingPose ? 0.5 : 1, flex: 1 }}
              title="Run DWPreprocessor on each generated directional concept image"
            >
              {detectingPose ? 'Detecting...' : 'Detect View Poses'}
            </button>
          </div>
          {Object.values(detectedViewPoseUrls).some(Boolean) && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70b8d8' }}>
              {Object.values(detectedViewPoseUrls).filter(Boolean).length}/4 view skeletons
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Generate Directional Concepts ── */}
      <StepHeader step={4} title="Generate Directional Concepts" status={step4Status} expanded={expandedSteps[4]} onToggle={() => toggleStep(4)} />
      {expandedSteps[4] && (
        <div style={styles.stepBody}>
          {!step3Done && <div style={styles.disabledHint}>Complete step 3 first</div>}

          <div style={styles.poseSettings}>
            <Row>
              <label style={styles.settingLabel}>IP Weight</label>
              <input type="range" min={0.1} max={1.0} step={0.05} value={aiConfig.ipAdapterWeight} onChange={(e) => setAIConfig({ ipAdapterWeight: parseFloat(e.target.value) })} style={{ flex: 1 }} />
              <span style={styles.valLabel}>{aiConfig.ipAdapterWeight.toFixed(2)}</span>
            </Row>
            <Row>
              <label style={styles.settingLabel}>Pose Str</label>
              <input type="range" min={0.1} max={1.5} step={0.05} value={aiConfig.openPoseStrength} onChange={(e) => setAIConfig({ openPoseStrength: parseFloat(e.target.value) })} style={{ flex: 1 }} />
              <span style={styles.valLabel}>{aiConfig.openPoseStrength.toFixed(2)}</span>
            </Row>
            <Row>
              <label style={styles.settingLabel}>IPA Preset</label>
              <select value={aiConfig.ipAdapterPreset} onChange={(e) => setAIConfig({ ipAdapterPreset: e.target.value })} style={styles.settingSelect}>
                {['LIGHT - SD1.5 only (low strength)', 'STANDARD (medium strength)', 'VIT-G (medium strength)', 'PLUS (high strength)', 'PLUS FACE (portraits)', 'FULL FACE - SD1.5 only (portraits stronger)'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Row>
          </div>

          <div style={styles.actionRow}>
            <select value={poseDirection} onChange={(e) => setPoseDirection(e.target.value as PoseOption)} style={styles.dirSelect} disabled={!step3Done}>
              {POSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button
              onClick={handleGeneratePoses}
              disabled={!step3Done || conceptPoseGenerating || noPrompt}
              style={{ ...styles.poseBtn, opacity: !step3Done || conceptPoseGenerating || noPrompt ? 0.5 : 1 }}
            >
              {conceptPoseGenerating ? 'Generating...' : 'Generate Poses'}
            </button>
            <button onClick={cancelGeneration} disabled={!conceptPoseGenerating} style={{ ...styles.cancelBtn, opacity: conceptPoseGenerating ? 1 : 0.3 }}>Cancel</button>
          </div>

          {conceptPoseGenerating && conceptPoseProgress && <div style={styles.progressText}>{conceptPoseProgress}</div>}
          {conceptPoseError && <div style={styles.errorText}>{conceptPoseError}</div>}
          {!conceptPoseGenerating && conceptPoseProgress && !conceptPoseError && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870', textAlign: 'center' }}>{conceptPoseProgress}</div>
          )}
        </div>
      )}

      {/* ── Step 5: Generate Chibi Art ── */}
      <StepHeader step={5} title="Generate Chibi" status={step5Status} expanded={expandedSteps[5]} onToggle={() => toggleStep(5)} />
      {expandedSteps[5] && (
        <div style={styles.stepBody}>
          {!step4Done && <div style={styles.disabledHint}>Complete step 4 first</div>}

          <label style={styles.label}>Style Prompt</label>
          <textarea value={chibiStylePrompt} onChange={(e) => setChibiStylePrompt(e.target.value)} rows={2} style={styles.textarea} placeholder="chibi, super deformed..." />

          <label style={styles.label}>Negative Prompt</label>
          <textarea value={chibiNegativePrompt} onChange={(e) => setChibiNegativePrompt(e.target.value)} rows={2} style={styles.textarea} placeholder="realistic, photograph..." />

          <ComfySettingsPanel label="Chibi" settings={chibiComfySettings} onChange={setChibiComfySettings} savedSettings={manifest.chibi?.generation_settings} />

          <div style={styles.poseSettings}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#777', fontWeight: 600 }}>IP-Adapter (Identity)</span>
            <Row>
              <label style={styles.settingLabel}>Weight</label>
              <input type="range" min={0.1} max={1.0} step={0.05} value={chibiIpWeight} onChange={(e) => setChibiIpWeight(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <span style={styles.valLabel}>{chibiIpWeight.toFixed(2)}</span>
            </Row>
            <Row>
              <label style={styles.settingLabel}>End At</label>
              <input type="range" min={0.3} max={1.0} step={0.05} value={chibiIpEndAt} onChange={(e) => setChibiIpEndAt(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <span style={styles.valLabel}>{chibiIpEndAt.toFixed(2)}</span>
            </Row>
          </div>

          <div style={styles.actionRow}>
            <select value={chibiGenDirection} onChange={(e) => setChibiGenDirection(e.target.value as 'all' | ViewDirection)} style={styles.dirSelect}>
              {POSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={handleGenerateChibi} disabled={!step4Done || chibiBusy} style={{ ...styles.conceptBtn, opacity: !step4Done || chibiBusy ? 0.5 : 1 }}>
              {chibiBusy ? 'Generating...' : 'Generate Chibi'}
            </button>
            <button onClick={cancelGeneration} disabled={!chibiBusy} style={{ ...styles.cancelBtn, opacity: chibiBusy ? 1 : 0.3 }}>Cancel</button>
          </div>

          {/* Upload chibi */}
          <div style={styles.actionRow}>
            <select value={chibiUploadDirection} onChange={(e) => setChibiUploadDirection(e.target.value as ViewDirection)} style={styles.dirSelect}>
              {(['front', 'back', 'right', 'left'] as ViewDirection[]).map((v) => <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>)}
            </select>
            <button onClick={handleChibiUpload} disabled={chibiBusy} style={{ ...styles.uploadBtn, opacity: chibiBusy ? 0.5 : 1 }}>Upload</button>
            <input ref={chibiFileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={handleChibiFileChange} />
          </div>

          {chibiGenerating && <div style={styles.progressText}>Sending to ComfyUI...</div>}
          {chibiViewsGenerating && chibiViewsProgress && <div style={styles.progressText}>{chibiViewsProgress}</div>}
          {chibiError && <div style={styles.errorText}>{chibiError}</div>}
          {chibiViewsError && <div style={styles.errorText}>{chibiViewsError}</div>}
          {!chibiViewsGenerating && chibiViewsProgress && !chibiViewsError && (
            <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#70d870', textAlign: 'center' }}>{chibiViewsProgress}</div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>{children}</div>;
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', gap: 2 },
  stepHeader: {
    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
    padding: '6px 8px', background: '#161628', border: '1px solid #2a2a3a',
    borderRadius: 4, cursor: 'pointer', marginTop: 2,
  },
  stepNumber: {
    fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: '#4a8af8',
    background: '#1e2e4a', borderRadius: '50%', width: 18, height: 18,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepTitle: { fontFamily: 'monospace', fontSize: 11, color: '#aaa', fontWeight: 600, flex: 1 },
  stepBadge: {
    fontFamily: 'monospace', fontSize: 8, padding: '1px 6px',
    borderRadius: 3, border: '1px solid',
  },
  stepArrow: { fontFamily: 'monospace', fontSize: 10, color: '#666', width: 12, flexShrink: 0 },
  stepBody: {
    padding: '8px 8px 8px 28px', display: 'flex', flexDirection: 'column' as const, gap: 4,
    borderLeft: '2px solid #2a2a3a', marginLeft: 8,
  },
  label: { fontFamily: 'monospace', fontSize: 10, color: '#666', marginTop: 4 },
  textarea: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 11, padding: '6px 8px', resize: 'vertical' as const, outline: 'none' },
  actions: { display: 'flex', gap: 6, marginTop: 6 },
  saveBtn: { flex: 1, background: '#1e3a6e', border: '1px solid #4a8af8', borderRadius: 4, color: '#90b8f8', fontFamily: 'monospace', fontSize: 10, padding: '6px 12px', cursor: 'pointer', fontWeight: 600 },
  remBgSection: { background: '#12121e', border: '1px solid #2a2a3a', borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column' as const, gap: 2 },
  remBgInput: { flex: 1, background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none' },
  actionRow: { display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 },
  dirSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 4, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', outline: 'none' },
  conceptBtn: { flex: 1, background: '#1e3a2e', border: '1px solid #44aa44', borderRadius: 4, color: '#70d870', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  poseBtn: { flex: 1, background: '#1e2e3a', border: '1px solid #4488cc', borderRadius: 4, color: '#70b8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  detectBtn: { background: '#2a2a3a', border: '1px solid #6a6a8a', borderRadius: 4, color: '#aaaacc', fontFamily: 'monospace', fontSize: 10, padding: '6px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  cancelBtn: { background: '#2a1a1a', border: '1px solid #553333', borderRadius: 4, color: '#d88', fontFamily: 'monospace', fontSize: 10, padding: '8px 10px', cursor: 'pointer', fontWeight: 600 },
  uploadBtn: { flex: 1, background: '#1e3a3a', border: '1px solid #4ac8c8', borderRadius: 4, color: '#90d8d8', fontFamily: 'monospace', fontSize: 10, padding: '8px 8px', cursor: 'pointer', fontWeight: 600, textAlign: 'center' },
  progressText: { fontFamily: 'monospace', fontSize: 9, color: '#8a4af8', textAlign: 'center' },
  errorText: { fontFamily: 'monospace', fontSize: 9, color: '#d88', background: '#2a1515', border: '1px solid #553333', borderRadius: 4, padding: '4px 6px' },
  disabledHint: { fontFamily: 'monospace', fontSize: 9, color: '#886600', background: '#2a2510', border: '1px solid #554400', borderRadius: 4, padding: '4px 8px', textAlign: 'center' },
  poseSettings: { background: '#131324', border: '1px solid #2a2a3a', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 4 },
  settingLabel: { fontFamily: 'monospace', fontSize: 9, color: '#666', minWidth: 55 },
  settingSelect: { background: '#1a1a2e', border: '1px solid #3a3a5a', borderRadius: 3, color: '#ddd', fontFamily: 'monospace', fontSize: 10, padding: '3px 6px', outline: 'none', flex: 1 },
  valLabel: { fontSize: 9, color: '#888', fontFamily: 'monospace', minWidth: 30 },
};
