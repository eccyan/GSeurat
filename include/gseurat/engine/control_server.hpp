#pragma once

#include <cstdint>
#include <nlohmann/json.hpp>
#include <set>
#include <string>
#include <vector>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace gseurat {

class ControlServer {
public:
    ~ControlServer();

#ifdef _WIN32
    bool start(const std::string& pipe_name = R"(\\.\pipe\gseurat)");
#else
    bool start(const std::string& socket_path = "/tmp/gseurat.sock");
#endif
    void stop();
    bool has_client() const { return !clients_.empty(); }

    // Called each frame — non-blocking accept + read.
    // Returns parsed JSON command objects with the source target each command
    // came from. Callers MUST set the reply target via `set_reply_target()`
    // before each dispatch so `send()` routes correctly when multiple clients
    // are connected (Bridge, Game Director, harness, etc. simultaneously).
    using ReplyTarget = std::int64_t;
    struct ParsedCommand {
        nlohmann::json cmd;
        ReplyTarget source;
    };
    std::vector<ParsedCommand> poll();

    // Set the active reply target — `send()` will route to this until updated.
    void set_reply_target(ReplyTarget target) noexcept;

    // Send JSON line to the client identified by the most recent
    // set_reply_target() call (or by the most recent parsed command).
    void send(const nlohmann::json& msg);

    // Broadcast JSON line to all connected clients.
    void broadcast(const nlohmann::json& msg);

    // Capture/replay the current reply target so a command's response can be
    // deferred to a later frame (e.g. step completion). Opaque integer encoding
    // is platform-specific (fd on Unix, HANDLE pointer on Windows).
    ReplyTarget current_reply_target() const noexcept;
    void send_to_target(ReplyTarget target, const nlohmann::json& msg);

    // Event subscription filtering
    void subscribe_events(const std::vector<std::string>& events);
    void unsubscribe_all();
    bool is_event_subscribed(const std::string& event) const;

private:
#ifdef _WIN32
    // Windows Named Pipe implementation
    struct Client {
        HANDLE pipe = INVALID_HANDLE_VALUE;
        OVERLAPPED overlap{};
        std::string read_buffer;
        char pending_buf[4096]{};
        bool read_pending = false;
    };

    HANDLE listen_pipe_ = INVALID_HANDLE_VALUE;
    OVERLAPPED listen_overlap_{};
    bool connect_pending_ = false;
    std::string pipe_name_;

    void create_listen_pipe();
    void try_accept();
    void disconnect_client(size_t index);
    void send_to(HANDLE pipe, const nlohmann::json& msg);
    void start_read(Client& client);

    std::vector<Client> clients_;
    HANDLE reply_pipe_ = INVALID_HANDLE_VALUE;
#else
    // Unix domain socket implementation
    struct Client {
        int fd = -1;
        std::string read_buffer;
    };

    int server_fd_ = -1;
    std::string socket_path_;

    void try_accept();
    void disconnect_client(size_t index);
    void send_to(int fd, const nlohmann::json& msg);

    std::vector<Client> clients_;
    int reply_fd_ = -1;
#endif

    std::set<std::string> subscribed_events_;
    bool has_subscriptions_ = false;  // true after subscribe, false after unsubscribe
};

}  // namespace gseurat
