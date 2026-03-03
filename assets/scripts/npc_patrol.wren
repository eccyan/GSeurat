import "./engine" for Engine

// Example NPC patrol script driven by Wren.
// Demonstrates reading/writing entity positions and using game flags.
class NpcPatrol {
    static update(entity_id, dt) {
        var pos = Engine.get_position(entity_id)
        if (pos == null) return

        var x = pos[0]
        var y = pos[1]
        var z = pos[2]

        // Simple patrol: move right until x > 3, then left until x < -3.
        var facing = Engine.get_facing(entity_id)
        var speed = 1.5

        if (facing == "right") {
            x = x + speed * dt
            if (x > 3) {
                Engine.set_facing(entity_id, "left")
            }
        } else if (facing == "left") {
            x = x - speed * dt
            if (x < -3) {
                Engine.set_facing(entity_id, "right")
            }
        }

        Engine.set_position(entity_id, x, y, z)

        // Example: set a game flag when this NPC reaches the right side.
        if (x > 2.5 && !Engine.get_flag("patrol_reached_right")) {
            Engine.set_flag("patrol_reached_right", true)
            Engine.log("NPC %(entity_id) reached the right side!")
        }
    }
}
