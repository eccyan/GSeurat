find_program(GLSLC glslc HINTS
    $ENV{VULKAN_SDK}/bin
    /usr/bin
)

if(NOT GLSLC)
    message(FATAL_ERROR "glslc not found. Install the Vulkan SDK.")
endif()

set(SHADER_SOURCE_DIR ${CMAKE_CURRENT_SOURCE_DIR})
set(SHADER_OUTPUT_DIR ${CMAKE_BINARY_DIR}/shaders)

file(MAKE_DIRECTORY ${SHADER_OUTPUT_DIR})

set(SHADER_SOURCES
    ${SHADER_SOURCE_DIR}/triangle.vert
    ${SHADER_SOURCE_DIR}/triangle.frag
    ${SHADER_SOURCE_DIR}/sprite.vert
    ${SHADER_SOURCE_DIR}/sprite.frag
)

set(SHADER_OUTPUTS "")

foreach(SHADER_SRC ${SHADER_SOURCES})
    get_filename_component(SHADER_NAME ${SHADER_SRC} NAME)
    set(SHADER_OUT ${SHADER_OUTPUT_DIR}/${SHADER_NAME}.spv)
    add_custom_command(
        OUTPUT ${SHADER_OUT}
        COMMAND ${GLSLC} ${SHADER_SRC} -o ${SHADER_OUT}
        DEPENDS ${SHADER_SRC}
        COMMENT "Compiling shader ${SHADER_NAME}"
    )
    list(APPEND SHADER_OUTPUTS ${SHADER_OUT})
endforeach()

add_custom_target(shaders DEPENDS ${SHADER_OUTPUTS})
