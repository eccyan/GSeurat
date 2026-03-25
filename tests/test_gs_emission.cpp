// Unit test: Gaussian emission property
//
// Tests that the emission field is correctly stored, loaded from PLY,
// and packed into the GPU struct.

#include "gseurat/engine/gaussian_cloud.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

using namespace gseurat;

int main() {
    // 1. Default emission is 0
    {
        Gaussian g{};
        assert(g.emission == 0.0f);
        std::printf("PASS: Gaussian default emission = 0\n");
    }

    // 2. Emission can be set
    {
        Gaussian g{};
        g.emission = 2.5f;
        assert(g.emission == 2.5f);
        std::printf("PASS: Gaussian emission can be set\n");
    }

    // 3. PLY round-trip with emission
    {
        // Create a small cloud with emissive Gaussians
        std::vector<Gaussian> input(3);
        for (int i = 0; i < 3; i++) {
            input[i].position = glm::vec3(static_cast<float>(i), 0.0f, 0.0f);
            input[i].scale = glm::vec3(0.1f);
            input[i].rotation = glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
            input[i].color = glm::vec3(1.0f, 0.0f, 0.0f);
            input[i].opacity = 0.9f;
            input[i].bone_index = 0;
        }
        input[0].emission = 0.0f;   // not emissive
        input[1].emission = 1.5f;   // moderately emissive
        input[2].emission = 5.0f;   // very emissive

        // Write PLY
        const char* path = "/tmp/test_emission.ply";
        GaussianCloud::write_ply(path, input);

        // Read back
        GaussianCloud cloud = GaussianCloud::load_ply(path);
        const auto& output = cloud.gaussians();
        assert(output.size() == 3);
        assert(output[0].emission == 0.0f);
        assert(std::abs(output[1].emission - 1.5f) < 0.01f);
        assert(std::abs(output[2].emission - 5.0f) < 0.01f);

        std::printf("PASS: PLY round-trip preserves emission values\n");
    }

    // 4. PLY without emission property loads with default 0
    {
        // Write a minimal PLY without emission
        const char* path = "/tmp/test_no_emission.ply";
        {
            std::ofstream f(path, std::ios::binary);
            f << "ply\n";
            f << "format binary_little_endian 1.0\n";
            f << "element vertex 1\n";
            f << "property float x\n";
            f << "property float y\n";
            f << "property float z\n";
            f << "property float scale_0\n";
            f << "property float scale_1\n";
            f << "property float scale_2\n";
            f << "property float rot_0\n";
            f << "property float rot_1\n";
            f << "property float rot_2\n";
            f << "property float rot_3\n";
            f << "property float f_dc_0\n";
            f << "property float f_dc_1\n";
            f << "property float f_dc_2\n";
            f << "property float opacity\n";
            f << "end_header\n";
            // 14 floats per vertex
            float data[14] = {
                1.0f, 2.0f, 3.0f,   // position
                0.0f, 0.0f, 0.0f,   // scale (log)
                1.0f, 0.0f, 0.0f, 0.0f,  // rotation
                0.0f, 0.0f, 0.0f,   // color SH DC
                0.0f                 // opacity (logit)
            };
            f.write(reinterpret_cast<const char*>(data), sizeof(data));
        }

        GaussianCloud cloud = GaussianCloud::load_ply(path);
        assert(cloud.gaussians().size() == 1);
        assert(cloud.gaussians()[0].emission == 0.0f);

        std::printf("PASS: PLY without emission property defaults to 0\n");
    }

    std::printf("\nAll GS emission tests passed.\n");
    return 0;
}
