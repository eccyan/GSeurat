#version 450

layout(location = 0) in vec2 frag_uv;
layout(location = 0) out vec4 out_color;

layout(set = 0, binding = 0) uniform sampler2D scene_tex;
layout(set = 0, binding = 1) uniform sampler2D bloom_tex;
layout(set = 0, binding = 2) uniform sampler2D dof_tex;
layout(set = 0, binding = 3) uniform sampler2D depth_tex;

struct PointLight {
    vec4 position_and_radius;  // xy = world XZ, z = unused, w = radius
    vec4 color;                // rgb = color, a = intensity
};

layout(set = 0, binding = 4) uniform LightGlow {
    mat4 vp;                   // GS camera view-projection
    ivec4 light_params;        // x = count, y = screen_w, z = screen_h
    PointLight lights[8];
} glow;

layout(push_constant) uniform PushConstants {
    // vec4 0: bloom params
    float bloom_intensity;
    float exposure;
    float vignette_radius;
    float vignette_softness;
    // vec4 1: DoF params
    float dof_focus_distance;
    float dof_focus_range;
    float dof_max_blur;
    float _pad0;
    // vec4 2: depth + fog density
    float depth_A;  // far / (far - near)
    float depth_B;  // near * far / (far - near)
    float fog_density;
    float _pad1;
    // vec4 3: fog color + fade
    float fog_r;
    float fog_g;
    float fog_b;
    float fade_amount;
    // vec4 4: screen effects
    float ca_intensity;
    float flash_r;
    float flash_g;
    float flash_b;
} pc;

// Compute screen-space light glow contribution
vec3 compute_light_glow() {
    int count = glow.light_params.x;
    if (count <= 0) return vec3(0.0);

    vec3 total = vec3(0.0);

    for (int i = 0; i < count && i < 8; i++) {
        vec2 light_xz = glow.lights[i].position_and_radius.xy;
        float radius = glow.lights[i].position_and_radius.w;
        vec3 light_color = glow.lights[i].color.rgb;
        float intensity = glow.lights[i].color.a;
        float height = glow.lights[i].position_and_radius.z;

        // Project light 3D position to clip space via GS camera VP
        // Light world pos: (x, height, z) — using XZ from scene data
        vec4 clip = glow.vp * vec4(light_xz.x, height, light_xz.y, 1.0);
        if (clip.w <= 0.0) continue;  // behind camera

        // NDC to UV
        vec2 ndc = clip.xy / clip.w;
        vec2 light_uv = ndc * 0.5 + 0.5;

        // Distance from fragment to light center in UV space
        // Scale by aspect ratio for circular glow
        float aspect = float(glow.light_params.y) / float(max(glow.light_params.z, 1));
        vec2 diff = frag_uv - light_uv;
        diff.x *= aspect;

        float dist = length(diff);

        // Radius in screen space: approximate from world radius and depth
        float depth = clip.w;
        float screen_radius = (radius * 3.0) / max(depth, 0.1);
        screen_radius = clamp(screen_radius, 0.05, 1.0);

        // Soft radial falloff (cubic for gentle glow)
        float falloff = 1.0 - smoothstep(0.0, screen_radius, dist);
        falloff = falloff * falloff * falloff;

        // Strong glow with intensity multiplier
        total += light_color * intensity * falloff * 2.0;
    }

    return total;
}

void main() {
    // Chromatic aberration: radial R/B channel offset
    vec3 scene;
    if (pc.ca_intensity > 0.0001) {
        vec2 center = frag_uv - 0.5;
        float dist_from_center = length(center);
        vec2 dir = (dist_from_center > 0.0001) ? normalize(center) * pc.ca_intensity * dist_from_center : vec2(0.0);
        scene.r = texture(scene_tex, frag_uv + dir).r;
        scene.g = texture(scene_tex, frag_uv).g;
        scene.b = texture(scene_tex, frag_uv - dir).b;
    } else {
        scene = texture(scene_tex, frag_uv).rgb;
    }

    vec3 bloom = texture(bloom_tex, frag_uv).rgb;
    vec3 dof_blurred = texture(dof_tex, frag_uv).rgb;

    // Linearize depth: linear_z = B / (A - raw_depth)
    float raw_depth = texture(depth_tex, frag_uv).r;
    float linear_z = pc.depth_B / (pc.depth_A - raw_depth);

    // Circle of confusion from depth distance to focus plane
    float coc = smoothstep(0.0, pc.dof_focus_range,
                           abs(linear_z - pc.dof_focus_distance)) * pc.dof_max_blur;

    // Tilt-shift Y-bias: blur top and bottom edges for miniature/diorama look
    coc += abs(frag_uv.y - 0.45) * 0.3 * pc.dof_max_blur;
    coc = clamp(coc, 0.0, 1.0);

    // DoF blend
    vec3 color = mix(scene, dof_blurred, coc);

    // Depth-based fog (exponential squared)
    if (pc.fog_density > 0.0) {
        float fog_amount = 1.0 - exp(-pc.fog_density * linear_z * linear_z);
        fog_amount = clamp(fog_amount, 0.0, 1.0);
        vec3 fog_col = vec3(pc.fog_r, pc.fog_g, pc.fog_b);
        color = mix(color, fog_col, fog_amount);
    }

    // Additive bloom
    color = color + bloom * pc.bloom_intensity;

    // Reinhard tone mapping
    color = vec3(1.0) - exp(-color * pc.exposure);

    // Screen flash (additive, after tone mapping)
    color += vec3(pc.flash_r, pc.flash_g, pc.flash_b);

    // Vignette
    vec2 uv_centered = frag_uv - 0.5;
    float dist = length(uv_centered);
    float vignette = smoothstep(pc.vignette_radius, pc.vignette_radius - pc.vignette_softness, dist);
    color *= vignette;

    // Scene fade (for transitions)
    color *= (1.0 - pc.fade_amount);

    out_color = vec4(color, 1.0);
}
