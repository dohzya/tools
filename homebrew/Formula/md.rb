class Md < Formula
  desc "Markdown surgeon - powerful markdown file manipulation tool"
  homepage "https://github.com/dohzya/tools"
  version "0.10.1"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.1/md-darwin-arm64"
      sha256 "8583fd4db96323953dbccbe911f428e50de6b9a1058d08ecf6c883e54459dab0"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.1/md-darwin-x86_64"
      sha256 "9a5f313fabd29728f885ff9a4a497a85def7e826f65e26c22f5430ef1535e149"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.1/md-linux-arm64"
      sha256 "622afb71711f4c2c08196be0f5d25fbea1dd39354c45833e3f9cf1ce6d8145a6"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.1/md-linux-x86_64"
      sha256 "46cbd13b574c12252a382c3a73121bd60fc9a5a895c68e5a2f48c967445a3ece"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "md-darwin-arm64"
      else
        "md-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "md-linux-arm64"
      else
        "md-linux-x86_64"
      end
    end

    bin.install binary_name => "md"
  end

  test do
    system "#{bin}/md", "--help"
  end
end
