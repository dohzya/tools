class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.4.3"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.3/wl-darwin-arm64"
      sha256 "0fde2b6488a19d4553d758c3eed25da82055fb29cf7c6a65a628a81cfe5b33e0"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.3/wl-darwin-x86_64"
      sha256 "dc777a0254ac03554362b700d6a4e66e31a94bd040a872fb559fc4a001ff95a2"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.3/wl-linux-arm64"
      sha256 "fab9eb2fe4f9876879e1742496d21d6bc74f45ec607f1ce57619de60291d7c26"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.4.3/wl-linux-x86_64"
      sha256 "61c1803324f50ab29401ed1dd280a7d0027d9344b0e88c9a1aa666605cbcd2c9"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "wl-darwin-arm64"
      else
        "wl-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "wl-linux-arm64"
      else
        "wl-linux-x86_64"
      end
    end

    bin.install binary_name => "wl"
  end

  test do
    system "#{bin}/wl", "--help"
  end
end
