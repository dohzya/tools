class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.4.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.4.0/recap-darwin-arm64"
      sha256 "77fa5e51216a15a043fdf53ef901483a849612c3f3b081a13bc1ada6b95b375d"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.4.0/recap-darwin-x86_64"
      sha256 "17d166447e3ad73a64ae826cb5ba3568db7c8934723804a7f39449259a684570"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.4.0/recap-linux-arm64"
      sha256 "b9225490e800c5360ecaf7baa2c6e5969d1d3b8346404199f925e9fbd2ea51d9"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.4.0/recap-linux-x86_64"
      sha256 "e31caac735a99df0190d1699c74e0e990f79c1b7f097f14eb3090377af2c7052"
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
