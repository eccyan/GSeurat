import type { ProviderType, LLMProvider, ImageProvider, AudioProvider } from "./types.js";
import { OllamaClient } from "./ollama.js";
import { StableDiffusionWebUIClient } from "./sd-webui.js";

/** Categories for registered providers. */
export type ProviderCategory = "llm" | "image" | "audio" | "unknown";

/** Metadata returned by autoDetect() for each registered provider. */
export interface ProviderStatus {
  /** Whether the provider's server responded successfully. */
  available: boolean;
  /** The provider instance. */
  type: ProviderType;
  /** Detected category of this provider. */
  category: ProviderCategory;
}

/**
 * Determine which category a provider instance belongs to by duck-typing
 * the interface methods.
 */
function categorize(provider: ProviderType): ProviderCategory {
  if (typeof (provider as LLMProvider).generate === "function") return "llm";
  if (typeof (provider as ImageProvider).generateImage === "function") return "image";
  if (typeof (provider as AudioProvider).generateAudio === "function") return "audio";
  return "unknown";
}

/**
 * Registry for AI provider instances.
 *
 * Allows named registration of LLM, image, and audio providers and provides
 * an autoDetect() helper that probes all registered providers for availability.
 *
 * Default providers are pre-registered:
 *   - "ollama"     → OllamaClient    (LLM,   http://localhost:11434)
 *   - "sd-webui"   → StableDiffusionWebUIClient (Image, http://localhost:7860, Forge)
 *
 * Audio providers (Replicate, StableAudio, AudioCraft) must be registered
 * manually since they require credentials or a local server.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderType>();

  constructor() {
    // Register default providers pointing at their canonical local addresses
    this.register("ollama", new OllamaClient());
    this.register("sd-webui", new StableDiffusionWebUIClient());
  }

  /**
   * Register a provider under the given name.
   * Overwrites any existing registration with the same name.
   *
   * @param name     - Unique name for this provider
   * @param provider - Provider instance
   */
  register(name: string, provider: ProviderType): void {
    this.providers.set(name, provider);
  }

  /**
   * Retrieve a registered provider by name.
   *
   * @param name - Name used during registration
   * @returns The provider instance
   * @throws Error if no provider is registered under that name
   */
  get(name: string): ProviderType {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(
        `No provider registered under name "${name}". ` +
          `Registered providers: ${[...this.providers.keys()].join(", ")}`
      );
    }
    return provider;
  }

  /**
   * Return all registered provider names.
   */
  names(): string[] {
    return [...this.providers.keys()];
  }

  /**
   * Probe all registered providers in parallel to check which are reachable.
   *
   * Providers that implement `isAvailable()` are called directly. Providers
   * that do not expose this method are assumed to be unavailable.
   *
   * @returns Map from provider name → ProviderStatus
   */
  async autoDetect(): Promise<Map<string, ProviderStatus>> {
    const results = new Map<string, ProviderStatus>();

    const checks = [...this.providers.entries()].map(
      async ([name, provider]) => {
        const category = categorize(provider);
        let available = false;

        if (isCheckable(provider)) {
          try {
            available = await provider.isAvailable();
          } catch {
            available = false;
          }
        }

        results.set(name, { available, type: provider, category });
      }
    );

    await Promise.all(checks);
    return results;
  }
}

/**
 * Type guard for providers that expose an isAvailable() method.
 */
interface Checkable {
  isAvailable(): Promise<boolean>;
}

function isCheckable(provider: unknown): provider is Checkable {
  return (
    typeof provider === "object" &&
    provider !== null &&
    "isAvailable" in provider &&
    typeof (provider as Checkable).isAvailable === "function"
  );
}
