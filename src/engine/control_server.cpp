#include "gseurat/engine/control_server.hpp"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace gseurat {

ControlServer::~ControlServer() {
    stop();
}

bool ControlServer::start(const std::string& socket_path) {
    socket_path_ = socket_path;

    // Remove stale socket file if it exists
    ::unlink(socket_path_.c_str());

    server_fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
    if (server_fd_ < 0) {
        std::fprintf(stderr, "ControlServer: socket() failed: %s\n", std::strerror(errno));
        return false;
    }

    // Set non-blocking
    int flags = ::fcntl(server_fd_, F_GETFL, 0);
    ::fcntl(server_fd_, F_SETFL, flags | O_NONBLOCK);

    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;
    std::strncpy(addr.sun_path, socket_path_.c_str(), sizeof(addr.sun_path) - 1);

    if (::bind(server_fd_, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) < 0) {
        std::fprintf(stderr, "ControlServer: bind() failed: %s\n", std::strerror(errno));
        ::close(server_fd_);
        server_fd_ = -1;
        return false;
    }

    if (::listen(server_fd_, 1) < 0) {
        std::fprintf(stderr, "ControlServer: listen() failed: %s\n", std::strerror(errno));
        ::close(server_fd_);
        server_fd_ = -1;
        ::unlink(socket_path_.c_str());
        return false;
    }

    std::fprintf(stderr, "ControlServer: listening on %s\n", socket_path_.c_str());
    return true;
}

void ControlServer::stop() {
    disconnect_client();
    if (server_fd_ >= 0) {
        ::close(server_fd_);
        server_fd_ = -1;
    }
    if (!socket_path_.empty()) {
        ::unlink(socket_path_.c_str());
        socket_path_.clear();
    }
}

void ControlServer::try_accept() {
    if (server_fd_ < 0 || client_fd_ >= 0) return;

    int fd = ::accept(server_fd_, nullptr, nullptr);
    if (fd < 0) return;  // EAGAIN/EWOULDBLOCK — no pending connection

    // Set client non-blocking
    int flags = ::fcntl(fd, F_GETFL, 0);
    ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);

    client_fd_ = fd;
    read_buffer_.clear();
    std::fprintf(stderr, "ControlServer: client connected\n");
}

void ControlServer::disconnect_client() {
    if (client_fd_ >= 0) {
        ::close(client_fd_);
        client_fd_ = -1;
        read_buffer_.clear();
        std::fprintf(stderr, "ControlServer: client disconnected\n");
    }
}

std::vector<nlohmann::json> ControlServer::poll() {
    std::vector<nlohmann::json> commands;

    // Try accepting a new client if none connected
    try_accept();

    if (client_fd_ < 0) return commands;

    // Non-blocking read
    char buf[4096];
    while (true) {
        ssize_t n = ::recv(client_fd_, buf, sizeof(buf), 0);
        if (n > 0) {
            read_buffer_.append(buf, static_cast<size_t>(n));
        } else if (n == 0) {
            // Client closed connection
            disconnect_client();
            return commands;
        } else {
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            // Real error
            disconnect_client();
            return commands;
        }
    }

    // Parse complete lines
    size_t pos;
    while ((pos = read_buffer_.find('\n')) != std::string::npos) {
        std::string line = read_buffer_.substr(0, pos);
        read_buffer_.erase(0, pos + 1);

        if (line.empty()) continue;

        try {
            commands.push_back(nlohmann::json::parse(line));
        } catch (const nlohmann::json::parse_error&) {
            // Send error for malformed JSON
            send({{"type", "error"}, {"message", "invalid JSON"}});
        }
    }

    return commands;
}

void ControlServer::send(const nlohmann::json& msg) {
    if (client_fd_ < 0) return;

    std::string line = msg.dump() + "\n";
    const char* data = line.data();
    size_t remaining = line.size();

    while (remaining > 0) {
        ssize_t n = ::write(client_fd_, data, remaining);
        if (n < 0) {
            if (errno == EPIPE || errno == ECONNRESET) {
                disconnect_client();
            }
            return;
        }
        data += n;
        remaining -= static_cast<size_t>(n);
    }
}

void ControlServer::subscribe_events(const std::vector<std::string>& events) {
    subscribed_events_.clear();
    for (const auto& e : events) {
        subscribed_events_.insert(e);
    }
}

void ControlServer::unsubscribe_all() {
    subscribed_events_.clear();
}

bool ControlServer::is_event_subscribed(const std::string& event) const {
    if (subscribed_events_.empty()) return true;  // empty = all pass
    return subscribed_events_.count(event) > 0;
}

}  // namespace gseurat
