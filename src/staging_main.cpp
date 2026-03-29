#include "gseurat/staging/staging_app.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>

int main(int argc, char* argv[]) {
    gseurat::StagingApp staging;
    staging.parse_args(argc, argv);

    try {
        staging.run();
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << '\n';
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
