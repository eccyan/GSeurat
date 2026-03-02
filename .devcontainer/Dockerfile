ARG FEDORA_VERSION=43
FROM fedora:${FEDORA_VERSION}

USER 0

# Development tools
RUN dnf -y install dnf-plugins-core && \
    dnf -y install \
        clang \
        clang-tools-extra \
        cmake \
        ninja-build \
        git \
    && dnf clean all

# Vulkan SDK and tools
RUN dnf -y install \
        vulkan-headers \
        vulkan-loader-devel \
        vulkan-tools \
        vulkan-validation-layers-devel \
        mesa-vulkan-drivers \
        glslc \
        spirv-tools \
    && dnf clean all

# GLFW system dependencies (X11 and Wayland)
RUN dnf -y install \
        glfw-devel \
        libXrandr-devel \
        libXinerama-devel \
        libXcursor-devel \
        libXi-devel \
        wayland-devel \
        libxkbcommon-devel \
    && dnf clean all

# krunkit GPU remoting (M-series Mac support)
RUN dnf -y install dnf-plugins-core && \
    dnf -y copr enable slp/mesa-libkrun-vulkan && \
    dnf -y update && \
    dnf clean all

# Development user
RUN useradd -m developer
USER developer
WORKDIR /workspace

ENV LANG=en_US.UTF-8
