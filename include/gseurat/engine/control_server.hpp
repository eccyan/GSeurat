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
    bool has_client() const { return client_fd_ >= 0; }

    // Called each frame — non-blocking accept + read.
    // Returns parsed JSON command objects (empty if none).
    std::vector<nlohmann::json> poll();

    // Send JSON line to connected client.
    void send(const nlohmann::json& msg);

    // Event subscription filtering
    void subscribe_events(const std::vector<std::string>& events);
    void unsubscribe_all();
    bool is_event_subscribed(const std::string& event) const;

private:
    int server_fd_ = -1;
    int client_fd_ = -1;
    std::string socket_path_;
    std::string read_buffer_;
    std::set<std::string> subscribed_events_;  // empty = all events pass through

    void try_accept();
    void disconnect_client();
};

}  // namespace gseurat
