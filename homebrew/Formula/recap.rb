class Recap < Formula
  desc "Configurable project status dashboard for AI assistants"
  homepage "https://github.com/dohzya/tools"
  version "0.2.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.1/recap-darwin-arm64"
      sha256 "bf72736746cb17d01263470078efe02c727bd5ef9910d3366036bef20d51b77f"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.1/recap-darwin-x86_64"
      sha256 "545b123379928ec57b69905fd7b50635e7968d9ad9d954564d7264ae706d2618"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.1/recap-linux-arm64"
      sha256 "94a2d8f33a39f2486e09aafce1607b35dcf38f71a5548caf7172ce279eca432f"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/recap-v0.2.1/recap-linux-x86_64"
      sha256 "333f2f0b5db66793c0ef3857c5f736fbbcbe6c2ba2c19982834de3e5e20b546f"
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
