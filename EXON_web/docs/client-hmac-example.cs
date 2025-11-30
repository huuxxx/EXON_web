using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Net.Http;
using System.Threading.Tasks;

/// <summary>
/// Example C# client code for submitting scores with HMAC validation
/// to the Next.js /api/submit-score endpoint
/// </summary>
public class ScoreSubmissionClient
{
    // IMPORTANT: This secret key must match STATS_SECRET_KEY in your server environment
    // Store this securely in your game build (obfuscate or encrypt in production)
    private const string STATS_SECRET_KEY = "your-secret-key-here";
    private const string API_ENDPOINT = "https://your-domain.com/api/submit-score";

    public class GunStats
    {
        public string name { get; set; }  // pistol, shotgun, rifle, launcher, minigun
        public int kills { get; set; }
        public int damage { get; set; }
    }

    public class AbilityStats
    {
        public string name { get; set; }  // blast, blade, barrier, combustion, jump, warp
        public int uses { get; set; }
        public int utility { get; set; }  // Use *_utility naming: blast_utility, blade_utility, etc.
        public int kills { get; set; }  // Kill count for all abilities
    }

    public class StatsSubmission
    {
        public string steamId { get; set; }
        public string ticket { get; set; }
        public string difficulty { get; set; }  // "easy", "medium", "hard", "veryHard"
        public int finalScore { get; set; }  // Total time in milliseconds
        public List<int> roundTimes { get; set; }  // 10 round times in milliseconds
        public List<int> roundKills { get; set; }  // Kill count per round (length 10)
        public List<GunStats> gunStats { get; set; }
        public List<AbilityStats> abilityStats { get; set; }
        public string dataHMAC { get; set; }  // Computed signature
    }

    /// <summary>
    /// Computes HMAC-SHA256 signature for the stats data
    /// </summary>
    private static string ComputeHMAC(StatsSubmission submission)
    {
        // Create canonical data object (MUST match server order exactly)
        var canonicalData = new
        {
            steamId = submission.steamId,
            difficulty = submission.difficulty,
            finalScore = submission.finalScore,
            roundTimes = submission.roundTimes,
            roundKills = submission.roundKills,
            gunStats = submission.gunStats,
            abilityStats = submission.abilityStats
        };

        // Serialize to JSON with consistent formatting
        var jsonOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };
        string canonicalJson = JsonSerializer.Serialize(canonicalData, jsonOptions);

        // Compute HMAC-SHA256
        using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(STATS_SECRET_KEY)))
        {
            byte[] hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(canonicalJson));
            return BitConverter.ToString(hash).Replace("-", "").ToLower();
        }
    }

    /// <summary>
    /// Submits score to the API endpoint with HMAC signature
    /// </summary>
    public static async Task<bool> SubmitScore(
        string steamId,
        string steamTicketHex,
        string difficulty,
        int finalScore,
        List<int> roundTimes,
        List<int> roundKills,
        List<GunStats> gunStats,
        List<AbilityStats> abilityStats)
    {
        try
        {
            var submission = new StatsSubmission
            {
                steamId = steamId,
                ticket = steamTicketHex,
                difficulty = difficulty,
                finalScore = finalScore,
                roundTimes = roundTimes,
                roundKills = roundKills,
                gunStats = gunStats,
                abilityStats = abilityStats
            };

            // Compute HMAC signature
            submission.dataHMAC = ComputeHMAC(submission);

            // Serialize and send request
            var jsonOptions = new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase
            };
            string jsonBody = JsonSerializer.Serialize(submission, jsonOptions);

            using (var client = new HttpClient())
            {
                var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                var response = await client.PostAsync(API_ENDPOINT, content);

                if (response.IsSuccessStatusCode)
                {
                    Console.WriteLine("Score submitted successfully!");
                    return true;
                }
                else
                {
                    Console.WriteLine($"Score submission failed: {response.StatusCode}");
                    return false;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error submitting score: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Example usage with your existing StatsProperties system
    /// </summary>
    public static async Task ExampleSubmission()
    {
        // Get Steam data
        string steamId = "76561198012345678"; // From Steamworks API
        string ticketHex = "..."; // From GetAuthSessionTicket, converted to hex
        string difficulty = "medium"; // "easy", "medium", "hard", "veryHard"

        // Prepare round times (10 rounds in milliseconds)
        var roundTimes = new List<int>
        {
            25000, 26000, 24500, 27000, 25500,  // Rounds 1-5
            26500, 25000, 26000, 25500, 25000   // Rounds 6-10
        };
        int finalScore = roundTimes.Sum(); // 261000 ms = 4:21.000
        
        // Prepare round kills (must match spawn data limits)
        var roundKills = new List<int>
        {
            12, 15, 16, 20, 22,  // Rounds 1-5 (max: 12, 15, 15, 18, 21)
            26, 28, 31, 33, 37   // Rounds 6-10 (max: 25, 27, 30, 32, 36)
        };

        // Prepare gun stats
        var gunStats = new List<GunStats>
        {
            new GunStats { name = "pistol", kills = 50, damage = 25000 },
            new GunStats { name = "shotgun", kills = 40, damage = 35000 },
            new GunStats { name = "rifle", kills = 80, damage = 45000 },
            new GunStats { name = "launcher", kills = 30, damage = 40000 },
            new GunStats { name = "minigun", kills = 50, damage = 30000 }
        };

        // Prepare ability stats (NOW WITH KILLS)
        var abilityStats = new List<AbilityStats>
        {
            new AbilityStats { name = "blast", uses = 25, utility = 5000, kills = 10 },      // blast_utility = nanite
            new AbilityStats { name = "blade", uses = 30, utility = 8000, kills = 5 },       // blade_utility = healing
            new AbilityStats { name = "barrier", uses = 20, utility = 12000, kills = 0 },    // barrier_utility = absorbed
            new AbilityStats { name = "combustion", uses = 15, utility = 35, kills = 35 },   // combustion_utility MUST = kills
            new AbilityStats { name = "jump", uses = 0, utility = 0, kills = 0 },            // Not tracked yet
            new AbilityStats { name = "warp", uses = 0, utility = 0, kills = 0 }             // Not tracked yet
        };
        
        // NOTE: Gun kills (250) + Ability kills (50) = 300 total, which should match sum of roundKills (260)
        // Adjust these numbers to match your actual gameplay!

        // Submit to API
        bool success = await SubmitScore(steamId, ticketHex, difficulty, finalScore, roundTimes, roundKills, gunStats, abilityStats);
    }

    /// <summary>
    /// Integration with your existing StatsProperties system
    /// Call this at the end of round 10 when game completes
    /// </summary>
    public static async Task SubmitFromStatsProperties(StatsProperties stats, string steamId, string ticketHex, string difficulty)
    {
        // Extract round times and kills from your stats system
        var roundTimes = new List<int>();
        var roundKills = new List<int>();
        for (int i = 0; i < 10; i++)
        {
            // Assuming you track round completion times in milliseconds
            int roundTime = stats.GetRoundTime(i); // Implement this based on your timing system
            roundTimes.Add(roundTime);
            
            // Get kills for this round
            int kills = stats.GetRoundKills(i); // Implement this to return kills for round i
            roundKills.Add(kills);
        }
        int finalScore = roundTimes.Sum();

        // Extract gun stats
        var gunStats = new List<GunStats>
        {
            new GunStats 
            { 
                name = "pistol", 
                kills = stats.GetKills(SourceWeaponOrAbility.Pistol),
                damage = stats.GetDamage(SourceWeaponOrAbility.Pistol)
            },
            new GunStats 
            { 
                name = "shotgun", 
                kills = stats.GetKills(SourceWeaponOrAbility.Shotgun),
                damage = stats.GetDamage(SourceWeaponOrAbility.Shotgun)
            },
            new GunStats 
            { 
                name = "rifle", 
                kills = stats.GetKills(SourceWeaponOrAbility.Rifle),
                damage = stats.GetDamage(SourceWeaponOrAbility.Rifle)
            },
            new GunStats 
            { 
                name = "launcher", 
                kills = stats.GetKills(SourceWeaponOrAbility.Launcher),
                damage = stats.GetDamage(SourceWeaponOrAbility.Launcher)
            },
            new GunStats 
            { 
                name = "minigun", 
                kills = stats.GetKills(SourceWeaponOrAbility.Minigun),
                damage = stats.GetDamage(SourceWeaponOrAbility.Minigun)
            }
        };

        // Extract ability stats
        var abilityStats = new List<AbilityStats>
        {
            new AbilityStats 
            { 
                name = "blast", 
                uses = stats.GetAbilityUses(SourceWeaponOrAbility.Blast),
                utility = stats.GetNaniteSpent(), // blast_utility = nanite
                kills = stats.GetKills(SourceWeaponOrAbility.Blast)
            },
            new AbilityStats 
            { 
                name = "blade", 
                uses = stats.GetAbilityUses(SourceWeaponOrAbility.Blade),
                utility = stats.GetHealingDone(), // blade_utility = healing
                kills = stats.GetKills(SourceWeaponOrAbility.Blade)
            },
            new AbilityStats 
            { 
                name = "barrier", 
                uses = stats.GetAbilityUses(SourceWeaponOrAbility.Barrier),
                utility = stats.GetDamageAbsorbed(), // barrier_utility = absorbed
                kills = stats.GetKills(SourceWeaponOrAbility.Barrier)
            },
            new AbilityStats 
            { 
                name = "combustion", 
                uses = stats.GetAbilityUses(SourceWeaponOrAbility.Combustion),
                utility = stats.GetKills(SourceWeaponOrAbility.Combustion), // combustion_utility = kills
                kills = stats.GetKills(SourceWeaponOrAbility.Combustion) // SAME as utility for combustion
            },
            new AbilityStats 
            { 
                name = "jump", 
                uses = 0, // Reserved for future tracking
                utility = 0,
                kills = 0
            },
            new AbilityStats 
            { 
                name = "warp", 
                uses = 0, // Reserved for future tracking
                utility = 0,
                kills = 0
            }
        };

        await SubmitScore(steamId, ticketHex, difficulty, finalScore, roundTimes, roundKills, gunStats, abilityStats);
    }
}
