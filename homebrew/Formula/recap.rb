class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.5.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.5.0/recap-darwin-arm64"
      sha256 "ffa3347552935eacf4e8c2a29a7493150282995c63452db2421c1a68a6a51950"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.5.0/recap-darwin-x86_64"
      sha256 "a58424f0c88b1ea7b3c1a6506c7e2db90656539512e59ca75cd05ac040f4e41a"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.5.0/recap-linux-arm64"
      sha256 "db023780306a80d8aced8520e11049c7e3432b9bf618ed43f610ecbcf085ff5e"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.5.0/recap-linux-x86_64"
      sha256 "757a49cf0b8a7b3aaed7f548145953d162066cf4a4de7a89ecaf05aa1a416105"
    end
  end

  def install
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "recap-darwin-arm64"
      else
        "recap-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "recap-linux-arm64"
      else
        "recap-linux-x86_64"
      end
    end

    bin.install binary_name => "recap"
  end

  test do
    system "#{bin}/recap", "--help"
  end
end
