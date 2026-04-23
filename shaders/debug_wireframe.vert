#version 450

layout(location = 0) in vec3 in_position;

layout(set = 0, binding = 0) uniform UBO {
    mat4 vp;
    // Remaining UBO fields exist but we only read vp
} ubo;

layout(push_constant) uniform PushConstants {
    mat4 model;        // 64 bytes: translation + rotation (no non-uniform scale)
    vec4 color;        // 16 bytes: wireframe color RGBA
    vec4 shape_params; // 16 bytes: x=type(0=box,1=sphere,2=capsule), y=radius, z=half_height
    vec4 extents;      // 16 bytes: box half_extents.xyz (total: 112 bytes)
} pc;

layout(location = 0) out vec4 frag_color;

void main() {
    vec3 pos = in_position;
    int shape_type = int(pc.shape_params.x);

    if (shape_type == 0) {
        // Box: scale unit cube vertices by half_extents
        pos *= pc.extents.xyz;
    } else if (shape_type == 1) {
        // Sphere: uniform scale by radius
        pos *= pc.shape_params.y;
    } else {
        // Capsule: shape-aware vertex transformation
        // Vertex convention:
        //   |y| <= 0.501 → cylinder segment
        //   |y| > 0.501  → hemisphere cap
        float r = pc.shape_params.y;
        float hh = pc.shape_params.z;

        if (abs(pos.y) <= 0.501) {
            // Cylinder region: scale XZ by radius, Y by half_height*2
            pos.x *= r;
            pos.z *= r;
            pos.y *= hh * 2.0;
        } else {
            // Hemisphere cap: scale by radius, translate by +-half_height
            float sign_y = sign(pos.y);
            vec3 local_pos = vec3(pos.x, abs(pos.y) - 0.5, pos.z);
            local_pos *= r * 2.0;
            pos = vec3(local_pos.x, local_pos.y + sign_y * hh, local_pos.z);
        }
    }

    gl_Position = ubo.vp * pc.model * vec4(pos, 1.0);
    frag_color = pc.color;
}
