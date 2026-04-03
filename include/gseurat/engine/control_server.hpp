#pragma once

#include <nlohmann/json.hpp>
#include <set>
#include <string>
#include <vector>

namespace gseurat {

class ControlServer {
public:
    ~ControlServer();

    bool start(const std::string& socket_path = "/tmp/gseurat.sock");
    void stop();
    bool has_client() const { return !clients_.empty(); }

    // Called each frame — non-blocking accept + read.
    // Returns parsed JSON command objects (empty if none).
    std::vector<nlohmann::json> poll();

    // Send JSON line to the client that sent the most recent command.
    void send(const nlohmann::json& msg);

    // Broadcast JSON line to all connected clients.
    void broadcast(const nlohmann::json& msg);

    // Event subscription filtering
    void subscribe_events(const std::vector<std::string>& events);
    void unsubscribe_all();
    bool is_event_subscribed(const std::string& event) const;

private:
    struct Client {
        int fd = -1;
        std::string read_buffer;
    };

    int server_fd_ = -1;
    std::string socket_path_;
    std::vector<Client> clients_;
    int reply_fd_ = -1;  // fd of client whose command is being processed
    std::set<std::string> subscribed_events_;

    void try_accept();
    void disconnect_client(size_t index);
    void send_to(int fd, const nlohmann::json& msg);
};

}  // namespace gseurat
