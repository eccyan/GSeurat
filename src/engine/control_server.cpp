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

    if (::listen(server_fd_, 8) < 0) {
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
    for (size_t i = clients_.size(); i > 0; --i) {
        disconnect_client(i - 1);
    }
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
    if (server_fd_ < 0) return;

    // Accept all pending connections
    while (true) {
        int fd = ::accept(server_fd_, nullptr, nullptr);
        if (fd < 0) break;  // EAGAIN/EWOULDBLOCK — no more pending

        // Set client non-blocking
        int flags = ::fcntl(fd, F_GETFL, 0);
        ::fcntl(fd, F_SETFL, flags | O_NONBLOCK);

        clients_.push_back(Client{fd, {}});
        std::fprintf(stderr, "ControlServer: client connected (fd=%d, total=%zu)\n",
                     fd, clients_.size());
    }
}

void ControlServer::disconnect_client(size_t index) {
    if (index >= clients_.size()) return;
    int fd = clients_[index].fd;
    if (fd >= 0) {
        ::close(fd);
        std::fprintf(stderr, "ControlServer: client disconnected (fd=%d)\n", fd);
    }
    clients_.erase(clients_.begin() + static_cast<ptrdiff_t>(index));
}

std::vector<nlohmann::json> ControlServer::poll() {
    std::vector<nlohmann::json> commands;

    // Accept new clients
    try_accept();

    // Read from all clients
    for (size_t i = 0; i < clients_.size(); ) {
        auto& client = clients_[i];
        bool dead = false;

        char buf[4096];
        while (true) {
            ssize_t n = ::recv(client.fd, buf, sizeof(buf), 0);
            if (n > 0) {
                client.read_buffer.append(buf, static_cast<size_t>(n));
            } else if (n == 0) {
                dead = true;
                break;
            } else {
                if (errno == EAGAIN || errno == EWOULDBLOCK) break;
                dead = true;
                break;
            }
        }

        // Parse complete lines
        size_t pos;
        while ((pos = client.read_buffer.find('\n')) != std::string::npos) {
            std::string line = client.read_buffer.substr(0, pos);
            client.read_buffer.erase(0, pos + 1);

            if (line.empty()) continue;

            try {
                auto cmd = nlohmann::json::parse(line);
                reply_fd_ = client.fd;  // track who sent this command
                commands.push_back(std::move(cmd));
            } catch (const nlohmann::json::parse_error&) {
                send_to(client.fd, {{"type", "error"}, {"message", "invalid JSON"}});
            }
        }

        if (dead) {
            disconnect_client(i);
            // Don't increment — erase shifted elements
        } else {
            ++i;
        }
    }

    return commands;
}

void ControlServer::send(const nlohmann::json& msg) {
    send_to(reply_fd_, msg);
}

void ControlServer::broadcast(const nlohmann::json& msg) {
    for (size_t i = 0; i < clients_.size(); ) {
        send_to(clients_[i].fd, msg);
        // send_to doesn't remove clients, so always increment
        ++i;
    }
}

void ControlServer::send_to(int fd, const nlohmann::json& msg) {
    if (fd < 0) return;

    std::string line = msg.dump() + "\n";
    const char* data = line.data();
    size_t remaining = line.size();

    while (remaining > 0) {
        ssize_t n = ::write(fd, data, remaining);
        if (n < 0) {
            if (errno == EPIPE || errno == ECONNRESET) {
                // Find and disconnect this client
                for (size_t i = 0; i < clients_.size(); ++i) {
                    if (clients_[i].fd == fd) {
                        disconnect_client(i);
                        break;
                    }
                }
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
    if (subscribed_events_.empty()) return true;
    return subscribed_events_.count(event) > 0;
}

}  // namespace gseurat
