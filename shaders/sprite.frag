#version 450

layout(location = 0) in vec2 frag_uv;
layout(location = 1) in vec4 frag_color;
layout(location = 2) in vec2 frag_world_pos;

layout(location = 0) out vec4 out_color;

layout(set = 0, binding = 1) uniform sampler2D tex_sampler;

struct PointLight {
    vec4 position_and_radius;
    vec4 color;
};

layout(set = 0, binding = 0) uniform UniformBufferObject {
    mat4 vp;
    vec4 ambient_color;
    ivec4 light_params;
    PointLight lights[8];
} ubo;

void main() {
    vec4 tex_color = texture(tex_sampler, frag_uv) * frag_color;

    // Ambient light
    vec3 lighting = ubo.ambient_color.rgb * ubo.ambient_color.a;

    // Accumulate point light contributions
    int count = ubo.light_params.x;
    for (int i = 0; i < count; i++) {
        vec2 light_pos  = ubo.lights[i].position_and_radius.xy;
        float radius    = ubo.lights[i].position_and_radius.w;
        vec3 light_col  = ubo.lights[i].color.rgb;
        float intensity = ubo.lights[i].color.a;

        float dist = distance(frag_world_pos, light_pos);
        float att = clamp(1.0 - (dist * dist) / (radius * radius), 0.0, 1.0);
        att *= att;  // quadratic falloff for soft HD-2D glow

        lighting += light_col * intensity * att;
    }

    out_color = vec4(tex_color.rgb * lighting, tex_color.a);
}
