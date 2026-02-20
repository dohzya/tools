class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.9.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.0/wl-darwin-arm64"
      sha256 "c758b39a9d9a4e3dfd59421af76247cf7cf62de90d188a59b94f63c98dcac73a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.0/wl-darwin-x86_64"
      sha256 "46484d232651a82a34aeee48ac9a739e9f665ab5f455c1c03a5d5e667d60376f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.0/wl-linux-arm64"
      sha256 "bb0c5e5b7ea31a845619bc33aff9a16cee269eca9146a9d6e9178ad21c661a1f"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.9.0/wl-linux-x86_64"
      sha256 "536cc409b84e109c97ae6f4f93a8a6a093ec47085080ceb87bbe002f07dc210e"
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
