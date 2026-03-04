#version 450

layout(location = 0) in vec2 frag_uv;
layout(location = 1) in vec4 frag_color;
layout(location = 2) in vec2 frag_world_pos;

layout(location = 0) out vec4 out_color;

layout(set = 0, binding = 1) uniform sampler2D tex_sampler;
layout(set = 0, binding = 2) uniform sampler2D normal_sampler;

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

    int count = ubo.light_params.x;
    bool use_normal_map = (ubo.light_params.y != 0);

    if (use_normal_map && count > 0) {
        // Sample and decode tangent-space normal
        vec3 N = texture(normal_sampler, frag_uv).rgb * 2.0 - 1.0;
        N = normalize(N);

        // View direction (straight down in 2D, looking at sprite plane)
        vec3 V = vec3(0.0, 0.0, 1.0);

        for (int i = 0; i < count; i++) {
            vec2 light_pos  = ubo.lights[i].position_and_radius.xy;
            float light_z   = ubo.lights[i].position_and_radius.z;
            float radius    = ubo.lights[i].position_and_radius.w;
            vec3 light_col  = ubo.lights[i].color.rgb;
            float intensity = ubo.lights[i].color.a;

            // 2D distance for radius falloff (HD-2D aesthetic)
            float dist2d = distance(frag_world_pos, light_pos);
            float att = clamp(1.0 - (dist2d * dist2d) / (radius * radius), 0.0, 1.0);
            att *= att;

            // 3D light direction for N.L and specular
            vec3 L = normalize(vec3(light_pos - frag_world_pos, light_z));

            // Lambert diffuse
            float NdotL = max(dot(N, L), 0.0);

            // Blinn-Phong specular
            vec3 H = normalize(L + V);
            float NdotH = max(dot(N, H), 0.0);
            float spec = pow(NdotH, 32.0) * 0.15;

            lighting += light_col * intensity * att * (NdotL + spec);
        }
    } else {
        // Original flat lighting (backward compatible)
        for (int i = 0; i < count; i++) {
            vec2 light_pos  = ubo.lights[i].position_and_radius.xy;
            float radius    = ubo.lights[i].position_and_radius.w;
            vec3 light_col  = ubo.lights[i].color.rgb;
            float intensity = ubo.lights[i].color.a;

            float dist = distance(frag_world_pos, light_pos);
            float att = clamp(1.0 - (dist * dist) / (radius * radius), 0.0, 1.0);
            att *= att;

            lighting += light_col * intensity * att;
        }
    }

    out_color = vec4(tex_color.rgb * lighting, tex_color.a);
}
