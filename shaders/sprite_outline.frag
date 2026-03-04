#version 450

layout(location = 0) in vec2 frag_uv;
layout(location = 1) in vec4 frag_color;  // carries UV bounds: xy=uv_min, zw=uv_max
layout(location = 2) in vec2 frag_world_pos;

layout(location = 0) out vec4 out_color;

layout(set = 0, binding = 1) uniform sampler2D tex_sampler;
layout(set = 0, binding = 2) uniform sampler2D normal_sampler;  // unused, layout compat

layout(push_constant) uniform PushConstants {
    vec4 outline_color;
    float outline_thickness;
    float _pad0;
    float _pad1;
    float _pad2;
} pc;

void main() {
    // Center pixel alpha
    float center_alpha = texture(tex_sampler, frag_uv).a;

    // If center is opaque, discard — the real entity sprite draws on top
    if (center_alpha > 0.1) {
        discard;
    }

    // UV bounds from vertex color attribute (clamping prevents atlas bleeding)
    vec2 uv_min = frag_color.xy;
    vec2 uv_max = frag_color.zw;

    // Texel size for neighbor sampling
    vec2 tex_size = vec2(textureSize(tex_sampler, 0));
    vec2 texel = pc.outline_thickness / tex_size;

    // 8-neighbor alpha check
    float max_neighbor = 0.0;
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2(-texel.x,  0.0),    uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2( texel.x,  0.0),    uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2( 0.0,     -texel.y), uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2( 0.0,      texel.y), uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2(-texel.x, -texel.y), uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2( texel.x, -texel.y), uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2(-texel.x,  texel.y), uv_min, uv_max)).a);
    max_neighbor = max(max_neighbor, texture(tex_sampler, clamp(frag_uv + vec2( texel.x,  texel.y), uv_min, uv_max)).a);

    // No opaque neighbor — not an edge pixel
    if (max_neighbor < 0.1) {
        discard;
    }

    // Output outline color (flat, no lighting)
    out_color = pc.outline_color * max_neighbor;
}
