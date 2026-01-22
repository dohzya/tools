class Md < Formula
  desc "Markdown surgeon - powerful markdown file manipulation tool"
  homepage "https://github.com/dohzya/dz-skills"
  version "0.4.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/dz-skills/releases/download/md-v0.4.0/md-darwin-arm64"
      sha256 "849dbfac96f950965dc4c7b64089e13349d315f2b6bfdb0b5eb651606cfbf6d1"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/dz-skills/releases/download/md-v0.4.0/md-darwin-x86_64"
      sha256 "0956c6ba35ec2a65164d148a135d8a24b1e4b76a056ebe1829a075612d4c1d67"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/dz-skills/releases/download/md-v0.4.0/md-linux-arm64"
      sha256 "11038e36831a636e9f9828ea999b3183600356b01ac4b7c6f2699bd0c7603c0a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/dz-skills/releases/download/md-v0.4.0/md-linux-x86_64"
      sha256 "ee1d459ea0d644e8a7d0b307241d554d87dc9164c9ebf674f9f7f82d43441c7a"
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
