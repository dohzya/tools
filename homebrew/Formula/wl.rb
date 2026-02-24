class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.9.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.2/wl-darwin-arm64"
      sha256 "257c2c95c2b6a6eef3b465d2a754b7a790ea0042575a0ffe4cf07e46c83bcbdb"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.2/wl-darwin-x86_64"
      sha256 "79ab89b07354fe0054f08523ed8714508aec4dd9fd80c51b355bf7d42e7910cc"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.2/wl-linux-arm64"
      sha256 "2f42e128932e46880eea3d02f51b4ab9455514f7a528662e926256777f5ec492"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.2/wl-linux-x86_64"
      sha256 "34c42e006e2c3e9bb6c37be150da1c511d66985fc5184b383e8a8b46bcd6b474"
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
