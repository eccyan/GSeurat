#ifdef _WIN32

#include "gseurat/engine/control_server.hpp"

#include <cstdio>
#include <cstring>

namespace gseurat {

ControlServer::~ControlServer() {
    stop();
}

bool ControlServer::start(const std::string& pipe_name) {
    pipe_name_ = pipe_name;
    create_listen_pipe();
    if (listen_pipe_ == INVALID_HANDLE_VALUE) return false;

    std::fprintf(stderr, "ControlServer: listening on %s\n", pipe_name_.c_str());
    return true;
}

void ControlServer::create_listen_pipe() {
    // Create a named pipe instance for the next client connection.
    // FILE_FLAG_OVERLAPPED enables non-blocking I/O.
    listen_pipe_ = CreateNamedPipeA(
        pipe_name_.c_str(),
        PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE * (clients_.empty() ? 1 : 0),
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
        PIPE_UNLIMITED_INSTANCES,
        4096,   // output buffer
        4096,   // input buffer
        0,      // default timeout
        nullptr // default security
    );

    if (listen_pipe_ == INVALID_HANDLE_VALUE) {
        // If FIRST_PIPE_INSTANCE failed (pipe already exists from prior instance),
        // retry without that flag.
        listen_pipe_ = CreateNamedPipeA(
            pipe_name_.c_str(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
            PIPE_UNLIMITED_INSTANCES,
            4096, 4096, 0, nullptr);
    }

    if (listen_pipe_ == INVALID_HANDLE_VALUE) {
        std::fprintf(stderr, "ControlServer: CreateNamedPipe failed (error %lu)\n",
                     GetLastError());
        return;
    }

    // Start an overlapped ConnectNamedPipe to wait for a client.
    std::memset(&listen_overlap_, 0, sizeof(listen_overlap_));
    listen_overlap_.hEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);

    BOOL connected = ConnectNamedPipe(listen_pipe_, &listen_overlap_);
    if (connected) {
        // Client already connected synchronously (rare).
        connect_pending_ = false;
    } else {
        DWORD err = GetLastError();
        if (err == ERROR_IO_PENDING) {
            connect_pending_ = true;
        } else if (err == ERROR_PIPE_CONNECTED) {
            // Client connected between Create and Connect calls.
            connect_pending_ = false;
            SetEvent(listen_overlap_.hEvent);
        } else {
            std::fprintf(stderr, "ControlServer: ConnectNamedPipe failed (error %lu)\n", err);
            CloseHandle(listen_pipe_);
            listen_pipe_ = INVALID_HANDLE_VALUE;
        }
    }
}

void ControlServer::stop() {
    for (size_t i = clients_.size(); i > 0; --i) {
        disconnect_client(i - 1);
    }
    if (listen_pipe_ != INVALID_HANDLE_VALUE) {
        CancelIo(listen_pipe_);
        CloseHandle(listen_pipe_);
        listen_pipe_ = INVALID_HANDLE_VALUE;
    }
    if (listen_overlap_.hEvent) {
        CloseHandle(listen_overlap_.hEvent);
        listen_overlap_.hEvent = nullptr;
    }
    connect_pending_ = false;
    pipe_name_.clear();
}

void ControlServer::try_accept() {
    if (listen_pipe_ == INVALID_HANDLE_VALUE) return;

    // Check if a client has connected.
    DWORD result = WaitForSingleObject(listen_overlap_.hEvent, 0);
    if (result != WAIT_OBJECT_0) return;  // No client yet.

    // A client connected — move this pipe handle to the client list.
    Client client;
    client.pipe = listen_pipe_;
    std::memset(&client.overlap, 0, sizeof(client.overlap));
    client.overlap.hEvent = CreateEventA(nullptr, TRUE, FALSE, nullptr);

    clients_.push_back(std::move(client));
    std::fprintf(stderr, "ControlServer: client connected (total=%zu)\n", clients_.size());

    // Start reading from the new client.
    start_read(clients_.back());

    // Reset listener state and create a new pipe instance for the next client.
    listen_pipe_ = INVALID_HANDLE_VALUE;
    if (listen_overlap_.hEvent) {
        CloseHandle(listen_overlap_.hEvent);
        listen_overlap_.hEvent = nullptr;
    }
    connect_pending_ = false;

    create_listen_pipe();
}

void ControlServer::start_read(Client& client) {
    if (client.read_pending) return;

    BOOL ok = ReadFile(
        client.pipe,
        client.pending_buf,
        sizeof(client.pending_buf),
        nullptr,
        &client.overlap);

    if (ok) {
        client.read_pending = true;  // Completed synchronously — will pick up in poll.
    } else {
        DWORD err = GetLastError();
        if (err == ERROR_IO_PENDING) {
            client.read_pending = true;
        }
        // ERROR_BROKEN_PIPE etc. will be caught in poll().
    }
}

void ControlServer::disconnect_client(size_t index) {
    if (index >= clients_.size()) return;
    auto& client = clients_[index];
    if (client.pipe != INVALID_HANDLE_VALUE) {
        CancelIo(client.pipe);
        DisconnectNamedPipe(client.pipe);
        CloseHandle(client.pipe);
        std::fprintf(stderr, "ControlServer: client disconnected\n");
    }
    if (client.overlap.hEvent) {
        CloseHandle(client.overlap.hEvent);
    }
    clients_.erase(clients_.begin() + static_cast<ptrdiff_t>(index));
}

std::vector<nlohmann::json> ControlServer::poll() {
    std::vector<nlohmann::json> commands;

    try_accept();

    for (size_t i = 0; i < clients_.size(); ) {
        auto& client = clients_[i];
        bool dead = false;

        // Check if pending read completed.
        if (client.read_pending) {
            DWORD bytes_read = 0;
            BOOL ok = GetOverlappedResult(client.pipe, &client.overlap, &bytes_read, FALSE);
            if (ok && bytes_read > 0) {
                client.read_buffer.append(client.pending_buf, bytes_read);
                client.read_pending = false;
                // Start another read.
                start_read(client);
            } else if (!ok) {
                DWORD err = GetLastError();
                if (err == ERROR_IO_INCOMPLETE) {
                    // Still pending — skip.
                } else {
                    // Broken pipe or other error.
                    dead = true;
                }
            }
        } else {
            // No read pending — start one.
            start_read(client);
        }

        // Parse complete JSON lines.
        size_t pos;
        while ((pos = client.read_buffer.find('\n')) != std::string::npos) {
            std::string line = client.read_buffer.substr(0, pos);
            client.read_buffer.erase(0, pos + 1);

            if (line.empty()) continue;

            try {
                auto cmd = nlohmann::json::parse(line);
                reply_pipe_ = client.pipe;
                commands.push_back(std::move(cmd));
            } catch (const nlohmann::json::parse_error&) {
                send_to(client.pipe, {{"type", "error"}, {"message", "invalid JSON"}});
            }
        }

        if (dead) {
            disconnect_client(i);
        } else {
            ++i;
        }
    }

    return commands;
}

void ControlServer::send(const nlohmann::json& msg) {
    send_to(reply_pipe_, msg);
}

void ControlServer::broadcast(const nlohmann::json& msg) {
    for (size_t i = 0; i < clients_.size(); ++i) {
        send_to(clients_[i].pipe, msg);
    }
}

void ControlServer::send_to(HANDLE pipe, const nlohmann::json& msg) {
    if (pipe == INVALID_HANDLE_VALUE) return;

    std::string line = msg.dump() + "\n";
    DWORD written = 0;
    // Synchronous write — fine for small JSON responses in the game loop.
    BOOL ok = WriteFile(pipe, line.data(), static_cast<DWORD>(line.size()), &written, nullptr);
    if (!ok) {
        DWORD err = GetLastError();
        if (err == ERROR_BROKEN_PIPE || err == ERROR_NO_DATA) {
            for (size_t i = 0; i < clients_.size(); ++i) {
                if (clients_[i].pipe == pipe) {
                    disconnect_client(i);
                    break;
                }
            }
        }
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

#endif  // _WIN32
